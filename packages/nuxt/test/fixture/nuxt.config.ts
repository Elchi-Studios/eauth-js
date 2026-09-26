// A Nuxt application that uses the module the way the README says.
export default defineNuxtConfig({
  modules: ["@elchi-studios/eauth-nuxt"],
  eauth: {
    clientId: "eauth_pub_fixturefixturefixture1",
    issuer: "https://auth.test",
  },
  compatibilityDate: "2026-09-01",
  devtools: { enabled: false },
  telemetry: false,
});
