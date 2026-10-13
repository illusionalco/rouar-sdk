import { z } from "zod";
//#region src/config.d.ts
/** リポジトリの直下に置く設定のファイルの名前 */
export declare const ROUAR_CONFIG_FILE = "rouar.json";
/** エージェントへ渡すパスの接頭辞の既定 */
export declare const DEFAULT_AGENT_ROUTES: readonly ["/agents"];
/** フロントエンドのフレームワーク。deployments.frontend_framework の enum と同じ値にする */
export declare const FRONTEND_FRAMEWORKS: readonly ["nuxt", "vue-vite", "sveltekit", "react-vite"];
/** 配信の形。deployments.frontend_kind の none 以外と同じ値にする */
export declare const FRONTEND_MODES: readonly ["ssr", "static"];
export type FrontendFramework = (typeof FRONTEND_FRAMEWORKS)[number];
export type FrontendMode = (typeof FRONTEND_MODES)[number];
declare const frontendSchema: z.ZodObject<{
  root: z.ZodOptional<z.ZodString>;
  framework: z.ZodOptional<z.ZodEnum<{
    nuxt: "nuxt";
    "vue-vite": "vue-vite";
    sveltekit: "sveltekit";
    "react-vite": "react-vite";
  }>>;
  mode: z.ZodOptional<z.ZodEnum<{
    ssr: "ssr";
    static: "static";
  }>>;
  buildCommand: z.ZodOptional<z.ZodString>;
  outputDir: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/**
 * rouar.json の形。ワーカーはビルドの前にこれで確かめる。
 * 利用者のコードを実行せずに読めるよう、TypeScript ではなく JSON にしている
 */
export declare const rouarConfigSchema: z.ZodObject<{
  $schema: z.ZodOptional<z.ZodString>;
  agent: z.ZodOptional<z.ZodObject<{
    root: z.ZodOptional<z.ZodString>;
    routes: z.ZodOptional<z.ZodArray<z.ZodString>>;
  }, z.core.$strict>>;
  frontend: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<false>, z.ZodObject<{
    root: z.ZodOptional<z.ZodString>;
    framework: z.ZodOptional<z.ZodEnum<{
      nuxt: "nuxt";
      "vue-vite": "vue-vite";
      sveltekit: "sveltekit";
      "react-vite": "react-vite";
    }>>;
    mode: z.ZodOptional<z.ZodEnum<{
      ssr: "ssr";
      static: "static";
    }>>;
    buildCommand: z.ZodOptional<z.ZodString>;
    outputDir: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>]>>;
}, z.core.$strict>;
export type RouarConfig = z.infer<typeof rouarConfigSchema>;
export type RouarFrontendConfig = z.infer<typeof frontendSchema>;
/** rouar.json の JSON Schema。パッケージの rouar.schema.json はこれを書き出したもの */
export declare function rouarConfigJsonSchema(): Record<string, unknown>;
export type RouarConfigIssue = {
  /** 違う項目の場所。`frontend.mode` のように書く。直下なら空 */
  path: string;
  message: string;
};
export type ParseRouarConfigResult = {
  success: true;
  config: RouarConfig;
} | {
  success: false;
  issues: RouarConfigIssue[];
};
/** rouar.json の文字列を読んで確かめる。合わなければ、どの項目が違うかを返す */
export declare function parseRouarConfig(text: string): ParseRouarConfigResult;
//#endregion
//# sourceMappingURL=config.d.mts.map