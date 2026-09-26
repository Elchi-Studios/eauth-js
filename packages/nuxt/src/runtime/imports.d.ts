// The parts of #imports the runtime uses, declared so the package compiles
// on its own. Nuxt supplies the real ones when it builds the application.
declare module "#imports" {
  export interface Ref<T> {
    value: T;
  }
  export interface NuxtApp {
    $eauth?: import("@elchi-studios/eauth").EAuth;
    isHydrating?: boolean;
    hooks: { hookOnce: (name: "app:suspense:resolve", fn: () => void) => unknown };
    provide: (name: string, value: unknown) => void;
    runWithContext: <T>(fn: () => T) => T;
  }
  export function useState<T>(key: string, init: () => T): Ref<T>;
  export function useNuxtApp(): NuxtApp;
  export function useRuntimeConfig(): { app: { baseURL: string }; public: { eauth?: Record<string, unknown> } };
  export function defineNuxtPlugin(plugin: (nuxtApp: NuxtApp) => unknown): unknown;
  export function defineNuxtRouteMiddleware(
    middleware: (to: { fullPath: string }, from: { fullPath: string }) => unknown,
  ): unknown;
  export function navigateTo(to: string, options?: { replace?: boolean }): unknown;
  export function abortNavigation(
    err?: string | { statusCode?: number; statusMessage?: string; message?: string; fatal?: boolean },
  ): unknown;
}
