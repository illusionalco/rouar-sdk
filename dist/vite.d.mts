import { Plugin } from "vite";
//#region src/vite.d.ts
export type RouarViteOptions = {
  /** エージェントの経路の接頭辞。省くと rouar.json の agent.routes を読み、なければ /agents */
  agentRoutes?: string[];
  /** 中継先。省くと ROUAR_AGENT_DEV_URL、なければ http://localhost:5173 */
  target?: string;
};
/** 接頭辞と、その下のパスだけに当てる。/agents は /agents-old に当てない */
export declare function proxyKey(route: string): string;
export declare function rouar(options?: RouarViteOptions): Plugin;
//#endregion
export { rouar as default };
//# sourceMappingURL=vite.d.mts.map