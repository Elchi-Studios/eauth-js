/**
 * @elchi-studios/eauth-nuxt: EAuth for Nuxt 3 and 4.
 *
 *   // nuxt.config.ts
 *   export default defineNuxtConfig({
 *     modules: ["@elchi-studios/eauth-nuxt"],
 *     eauth: { clientId: "eauth_pub_...", redirectUri: "https://app.example/" },
 *   });
 *
 *   // any component
 *   const { user, signIn, signOut } = useEAuth();
 *
 *   // a page that needs somebody signed in
 *   definePageMeta({ middleware: "eauth" });
 *
 * The client runs in the browser only. During server rendering the state
 * says loading, and it changes once the page has hydrated. The options can
 * also come from runtime config (NUXT_PUBLIC_EAUTH_CLIENT_ID and so on), so
 * one build serves several environments. Without a redirectUri the module
 * uses the application's root, which must then be registered.
 */

import {
  addImports,
  addPlugin,
  addRouteMiddleware,
  addTypeTemplate,
  createResolver,
  defineNuxtModule,
} from "@nuxt/kit";
import type { EAuthConfig } from "@elchi-studios/eauth";

export type ModuleOptions = Partial<Omit<EAuthConfig, "onChange">>;

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@elchi-studios/eauth-nuxt",
    configKey: "eauth",
    compatibility: { nuxt: ">=3.13.0" },
  },
  defaults: {},
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);

    // Public runtime config, so the values can be overridden per environment
    // without a new build (NUXT_PUBLIC_EAUTH_CLIENT_ID and so on). Only keys
    // present here can be overridden, so every text option is declared, empty
    // when unset. Values in runtimeConfig.public.eauth win over the module
    // options, as with other modules. Nothing here is a secret: a browser
    // application has none.
    const runtime = nuxt.options.runtimeConfig as { public: Record<string, unknown> };
    const given = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
    runtime.public.eauth = {
      clientId: "",
      redirectUri: "",
      postLogoutRedirectUri: "",
      issuer: "",
      scope: "",
      storage: "",
      ...given,
      ...(runtime.public.eauth as Record<string, unknown> | undefined),
    };

    // The runtime files import from #imports, which only resolves when Nuxt
    // processes them rather than taking them as a prebuilt dependency.
    const runtimeDir = resolve("./runtime");
    nuxt.options.build.transpile.push(runtimeDir);

    addPlugin({ src: resolve(runtimeDir, "plugin.client"), mode: "client" });
    addImports([{ name: "useEAuth", from: resolve(runtimeDir, "composables") }]);
    addRouteMiddleware({ name: "eauth", path: resolve(runtimeDir, "middleware") });

    // Types for useNuxtApp().$eauth. It is undefined on the server.
    addTypeTemplate({
      filename: "types/eauth.d.ts",
      getContents: () =>
        [
          'import type { EAuth } from "@elchi-studios/eauth";',
          "",
          'declare module "#app" {',
          "  interface NuxtApp {",
          "    $eauth?: EAuth;",
          "  }",
          "}",
          "",
          "export {};",
          "",
        ].join("\n"),
    });
  },
});
