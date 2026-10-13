import { startFixtures } from '../test/fixtures/server.mjs';
const fixture = await startFixtures({ port: 4173 });
console.log(`Demo catalog: ${fixture.origin}/catalog`);
console.log(`Demo queue: ${fixture.origin}/queue`);
const shutdown = async () => { await fixture.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
