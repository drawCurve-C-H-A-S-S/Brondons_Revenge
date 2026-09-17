/// <reference types="vite/client" />

declare module '*?raw' {
  const src: string;
  export default src;
}

declare module '*.glb' {
  const src: string;
  export default src;
}
