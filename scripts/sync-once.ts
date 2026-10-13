// Runs one sync outside Gloomberb and prints the snapshot it would import. The
// OAuth state is kept in .dev-oauth.json the way Gloomberb keeps it in the
// broker profile, so only the first run opens the sign-in.
import { loadFaraoPortfolio, takePersistedConfigUpdate } from "../native";

const stateFile = Bun.file(new URL("../.dev-oauth.json", import.meta.url));
const config = (await stateFile.exists()) ? await stateFile.json() : { connectionMode: "oauth" };
const instance = { id: "dev", brokerType: "farao", label: "Farao", config };

const snapshot = await loadFaraoPortfolio(instance);
const update = takePersistedConfigUpdate(instance.id);
if (update) await Bun.write(stateFile, JSON.stringify(update));
console.log(JSON.stringify(snapshot, null, 2));
