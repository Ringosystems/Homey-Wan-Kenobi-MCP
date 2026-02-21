import fs from "fs";
import path from "path";

// homey-api is CJS, use require
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const AthomCloudAPI = require("homey-api/lib/AthomCloudAPI");

let cachedApi: any = null;

export async function getHomeyApi(): Promise<any> {
  if (cachedApi) return cachedApi;

  // Strategy 1: Use Homey CLI stored OAuth token (~/.athom-cli/settings.json)
  const cliSettingsPath = path.join(
    process.env.HOME ?? "",
    ".athom-cli",
    "settings.json"
  );

  if (fs.existsSync(cliSettingsPath)) {
    const settings = JSON.parse(fs.readFileSync(cliSettingsPath, "utf8"));
    if (settings.homeyApi?.token) {
      const cloudApi = new AthomCloudAPI({
        clientId: "64691b4358336640a5ecee5c", // Homey CLI client ID
        clientSecret: "",
        token: new AthomCloudAPI.Token(settings.homeyApi.token),
      });

      const user = await cloudApi.getAuthenticatedUser();
      const homey = await user.getFirstHomey();
      cachedApi = await homey.authenticate();
      return cachedApi;
    }
  }

  // Strategy 2: Use HOMEY_ADDRESS + HOMEY_TOKEN env vars (local API key)
  const { HomeyAPI } = require("homey-api");
  const address = process.env.HOMEY_ADDRESS;
  const token = process.env.HOMEY_TOKEN;

  if (address && token) {
    cachedApi = await HomeyAPI.createLocalAPI({ address, token });
    return cachedApi;
  }

  throw new Error(
    "No Homey credentials found. Either:\n" +
      "  1. Run `homey login` and `homey select` (recommended)\n" +
      "  2. Set HOMEY_ADDRESS and HOMEY_TOKEN env vars (API key from https://my.homey.app/settings/system/api-keys)"
  );
}
