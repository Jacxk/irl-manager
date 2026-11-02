import 'dotenv/config';
import { startMoblinGateway } from './server';
import { sql } from '../src/lib/db';
const gateway = await startMoblinGateway();
console.log('Moblin gateway ready. Pairing is optional and controlled by instance policy.');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await gateway.close();
  await sql.end();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
