"""Continuous program pipeline plus an independently reconnecting input decoder.
Commands and telemetry use newline-delimited JSON. Media URLs arrive over stdin.
"""
import gi
import json
import re
import signal
import sys
import threading
import time
from timestamps import Stamp

gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib
Gst.init(None)
config = json.loads(sys.stdin.readline())
loop = GLib.MainLoop()
received_bytes = 0
previous_bytes = 0
previous_measurement = time.monotonic()
last_video = 0.0
last_audio = 0.0
stable_since = None
decoder_pipeline = None
connection_started = 0.0
next_connect = 0.0
force_fallback = bool(config.get('manual', False))
fatal = False
stopping = False
video_stamp = Stamp()
audio_stamp = Stamp()


def emit(**values):
    print(json.dumps(values), flush=True)


# A decoder failure never changes the state of this persistent output pipeline.
# Clock sync rewrites a burst onto one timestamp, and MediaMTX then closes the preview muxer.
program = Gst.parse_launch('''
    input-selector name=vsel sync-streams=true cache-buffers=true !
      queue ! videoconvert ! videorate ! video/x-raw,format=I420,width=1280,height=720,framerate=30/1 !
      x264enc tune=zerolatency speed-preset=veryfast bitrate=4500 key-int-max=60 !
      h264parse config-interval=-1 ! queue ! mux.
    input-selector name=asel sync-streams=true cache-buffers=true !
      queue ! audioconvert ! audioresample ! audiorate ! audio/x-raw,rate=48000,channels=2 !
      avenc_aac bitrate=128000 ! aacparse ! queue ! mux.
    flvmux name=mux streamable=true skip-backwards-streams=true ! queue ! rtmpsink name=output sync=false
    videotestsrc name=background is-live=true pattern=solid-color !
      video/x-raw,width=1280,height=720,framerate=30/1 !
      textoverlay name=title halignment=center valignment=center font-desc="Sans Bold 36" !
      textoverlay name=subtitle halignment=center valignment=bottom ypad=190 font-desc="Sans 19" !
      queue ! vsel.sink_0
    audiotestsrc is-live=true wave=silence !
      audio/x-raw,format=S16LE,rate=48000,channels=2 ! queue ! asel.sink_0
    appsrc name=livevideo is-live=true format=time block=false max-buffers=30 leaky-type=downstream
      caps="video/x-raw,format=I420,width=1280,height=720,framerate=30/1" !
      queue leaky=downstream max-size-buffers=15 ! vsel.sink_1
    appsrc name=liveaudio is-live=true format=time block=false max-buffers=100 leaky-type=downstream
      caps="audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved" !
      queue leaky=downstream max-size-buffers=50 ! asel.sink_1
''')
program.get_by_name('output').set_property('location', config['output'])
program.get_by_name('background').set_property('foreground-color', int('ff' + config['color'].lstrip('#'), 16))
program.get_by_name('title').set_property('text', config['title'])
program.get_by_name('subtitle').set_property('text', config['subtitle'])
vsel = program.get_by_name('vsel')
asel = program.get_by_name('asel')
vsel.set_property('active-pad', vsel.get_static_pad('sink_0'))
asel.set_property('active-pad', asel.get_static_pad('sink_0'))


def select_live(value):
    vsel.set_property('active-pad', vsel.get_static_pad('sink_1' if value else 'sink_0'))
    audio_live = value and time.monotonic() - last_audio < 2
    asel.set_property('active-pad', asel.get_static_pad('sink_1' if audio_live else 'sink_0'))


def on_sample(sink, kind):
    global last_video, last_audio, stable_since
    sample = sink.emit('pull-sample')
    if sample is None or stopping:
        return Gst.FlowReturn.OK
    now = time.monotonic()
    if kind == 'video':
        if now - last_video > 2:
            stable_since = now
        last_video = now
    else:
        last_audio = now
    # Every reconnect gets a fresh decoder clock. Keep source spacing, but never
    # let a burst or a restart emit equal or backwards timestamps. FLV stores
    # millisecond timestamps, and MediaMTX closes the preview muxer when they repeat.
    clock = program.get_clock()
    if clock is None:
        return Gst.FlowReturn.OK
    buf = sample.get_buffer().copy_deep()
    source_pts = None if buf.pts == Gst.CLOCK_TIME_NONE else int(buf.pts)
    program_now = max(0, int(clock.get_time() - program.get_base_time()))
    pts = (video_stamp if kind == 'video' else audio_stamp).apply(source_pts, program_now)
    buf.pts = pts
    buf.dts = pts
    program.get_by_name('livevideo' if kind == 'video' else 'liveaudio').emit('push-buffer', buf)
    return Gst.FlowReturn.OK


def on_pad(source, pad):
    caps = pad.get_current_caps() or pad.query_caps(None)
    name = caps.get_structure(0).get_name()
    kind = 'video' if name.startswith('video/') else 'audio' if name.startswith('audio/') else None
    if kind:
        sink = source.get_parent().get_by_name(kind + '_queue').get_static_pad('sink')
        if not sink.is_linked():
            pad.link(sink)


def reset_input(expected):
    global decoder_pipeline, next_connect, stable_since
    if decoder_pipeline is not expected:
        return False
    select_live(False)
    decoder_pipeline = None
    video_stamp.reset_source()
    audio_stamp.reset_source()
    expected.set_state(Gst.State.NULL)
    bus = expected.get_bus()
    bus.remove_signal_watch()
    stable_since = None
    next_connect = time.monotonic() + 3
    return False


def input_message(_bus, msg, source_pipeline):
    if msg.type in (Gst.MessageType.ERROR, Gst.MessageType.EOS):
        GLib.idle_add(reset_input, source_pipeline)


def connect_input():
    global decoder_pipeline, connection_started
    connection_started = time.monotonic()
    source = Gst.parse_launch('''
        uridecodebin name=decoder
        queue name=video_queue ! videoconvert ! videoscale ! videorate !
          video/x-raw,format=I420,width=1280,height=720,framerate=30/1 !
          appsink name=video_sink emit-signals=true sync=false async=false max-buffers=2 drop=true
        queue name=audio_queue ! audioconvert ! audioresample !
          audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved !
          appsink name=audio_sink emit-signals=true sync=false async=false max-buffers=8 drop=true
    ''')
    decoder_pipeline = source
    decoder = source.get_by_name('decoder')
    decoder.set_property('uri', config['input'])
    decoder.connect('pad-added', on_pad)
    def count_packet(_pad, info):
        global received_bytes
        buffer = info.get_buffer()
        if buffer:
            received_bytes += buffer.get_size()
        return Gst.PadProbeReturn.OK
    def watch_pad(_source, pad):
        pad.add_probe(Gst.PadProbeType.BUFFER, count_packet)
    def setup(_decoder, element):
        element.connect('pad-added', watch_pad)
        if element.find_property('latency'):
            element.set_property('latency', 200)
        if element.find_property('protocols'):
            element.set_property('protocols', 4)  # RTSP over TCP on the private media network.
    decoder.connect('source-setup', setup)
    source.get_by_name('video_sink').connect('new-sample', on_sample, 'video')
    source.get_by_name('audio_sink').connect('new-sample', on_sample, 'audio')
    bus = source.get_bus()
    bus.add_signal_watch()
    bus.connect('message', input_message, source)
    source.set_state(Gst.State.PLAYING)


def output_message(_bus, msg):
    global fatal
    if msg.type in (Gst.MessageType.ERROR, Gst.MessageType.EOS):
        fatal = True
        if msg.type == Gst.MessageType.ERROR:
            err, _ = msg.parse_error()
            emit(type='diagnostic', source=msg.src.get_name(), message=re.sub(r'(?:rtmps?|rtsp)://\S+', '[redacted]', err.message))
        emit(type='fatal', message='Program encoder or internal output failed.')
        loop.quit()


def tick():
    global previous_bytes, previous_measurement
    now = time.monotonic()
    healthy = last_video > 0 and now - last_video < 2
    ready = healthy and stable_since is not None and now - stable_since >= 5
    select_live(bool(ready and not force_fallback))
    if decoder_pipeline is None and now >= next_connect:
        connect_input()
    elif decoder_pipeline and now - connection_started > 15 and (last_video < connection_started or now - last_video > 8):
        reset_input(decoder_pipeline)
    receive_kbps = round((received_bytes - previous_bytes) * 8 / max(now - previous_measurement, 0.001) / 1000)
    previous_bytes, previous_measurement = received_bytes, now
    emit(type='health', receiveKbps=receive_kbps, lastFrameAgeMs=int((now - last_video) * 1000) if last_video else None,
         stableForMs=int((now - stable_since) * 1000) if healthy and stable_since else 0,
         selected='live' if ready and not force_fallback else 'fallback')
    return True


def control():
    global force_fallback
    for line in sys.stdin:
        try:
            cmd = json.loads(line)
            if cmd.get('action') == 'fallback':
                force_fallback = bool(cmd['enabled'])
            elif cmd.get('action') == 'stop':
                GLib.idle_add(loop.quit)
                return
        except (ValueError, KeyError):
            pass
    GLib.idle_add(loop.quit)

bus = program.get_bus()
bus.add_signal_watch()
bus.connect('message', output_message)
signal.signal(signal.SIGTERM, lambda *_: loop.quit())
signal.signal(signal.SIGINT, lambda *_: loop.quit())
threading.Thread(target=control, daemon=True).start()
program.set_state(Gst.State.PLAYING)
GLib.timeout_add(500, tick)
try:
    loop.run()
finally:
    stopping = True
    if decoder_pipeline:
        decoder_pipeline.set_state(Gst.State.NULL)
    program.set_state(Gst.State.NULL)
sys.exit(1 if fatal else 0)
