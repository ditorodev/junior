import { defineConfig } from "nitro";
import { juniorNitro } from "@sentry/junior/nitro";
import { hirevoicePluginPackages } from "./plugin-packages";

export default defineConfig({
  preset: "vercel",
  modules: [
    juniorNitro({
      plugins: {
        packages: hirevoicePluginPackages,
      },
    }),
  ],
  routes: {
    "/**": { handler: "./server.ts" },
  },
});
