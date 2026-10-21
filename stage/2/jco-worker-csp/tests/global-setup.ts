// Start the POC server on a random port for the whole run.
import { start } from '../src/server.ts';

export default async function globalSetup() {
  const { server, url } = await start(0);
  process.env.POC_URL = url;
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}
