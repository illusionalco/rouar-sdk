//#region src/nuxt.d.ts
export type RouarNuxtOptions = {
  /**
   * 許可の関数のファイル。h3 の event を受け取る関数を default で export する。
   * `~/server/rouar-authorize` のように Nuxt の alias で書ける
   */
  authorize?: string;
  /** エージェントの経路の接頭辞。省くと rouar.json の agent.routes を読み、なければ /agents */
  agentRoutes?: string[];
  /** 開発のときに、エージェントの経路を手元の Flue の開発のサーバーへ中継するか。既定は true */
  devProxy?: boolean;
  /** 中継先。省くと ROUAR_AGENT_DEV_URL、なければ http://localhost:5173 */
  devTarget?: string;
};
/** このモジュールが読み書きする Nuxt の設定の部分 */
type NuxtOptionsLike = {
  rootDir: string;
  srcDir: string;
  buildDir: string;
  dev: boolean;
  alias: Record<string, string>;
  plugins: (string | {
    src: string;
    mode?: "all" | "server" | "client";
  })[];
  build: {
    templates: {
      filename: string;
      write?: boolean;
      getContents: () => string;
    }[];
  };
  rouar?: RouarNuxtOptions;
};
type NitroConfigLike = {
  plugins?: string[];
  handlers?: {
    route: string;
    handler: string;
    method?: string;
  }[];
  virtual?: Record<string, string | (() => string | Promise<string>)>;
  imports?: false | {
    imports?: {
      name: string;
      from: string;
    }[];
  };
};
type ImportLike = {
  name: string;
  from: string;
};
export type NuxtLike = {
  options: NuxtOptionsLike;
  hook(name: "imports:extend", fn: (imports: ImportLike[]) => void): unknown;
  hook(name: "nitro:config", fn: (config: NitroConfigLike) => void): unknown;
};
/** Nuxt の alias を当てて、許可の関数のファイルの絶対パスを決める。見つからなければ例外にする */
export declare function resolveAuthorizePath(path: string, options: Pick<NuxtOptionsLike, "rootDir" | "alias">): string;
/** Nuxt のモジュールの本体。nuxt.config の modules に "@rouar/sdk/nuxt" を書くと呼ばれる */
declare function rouarNuxtModule(inlineOptions: RouarNuxtOptions | undefined, nuxt: NuxtLike): void;
declare namespace rouarNuxtModule {
  var getMeta: () => Promise<{
    name: string;
    configKey: string;
  }>;
}
//#endregion
export { rouarNuxtModule as default };
//# sourceMappingURL=nuxt.d.mts.map