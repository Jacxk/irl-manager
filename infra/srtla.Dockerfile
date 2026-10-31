FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone https://github.com/BELABOX/srtla.git . && git checkout 37862da3d0c13b46956efd3f88877053293d97d6 && make srtla_rec
FROM debian:bookworm-slim
COPY --from=build /src/srtla_rec /usr/local/bin/srtla_rec
USER nobody
EXPOSE 5000/udp
ENTRYPOINT ["srtla_rec"]
CMD ["5000", "media", "8890"]
