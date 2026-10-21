export class GpuTimer {
  private readonly gl: WebGL2RenderingContext | null;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private history: number[] = [];

  constructor(context: unknown) {
    this.gl = context instanceof WebGL2RenderingContext ? context : null;
    this.ext = this.gl
      ? (this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimer['ext'])
      : null;
  }

  get supported() {
    return this.ext !== null;
  }

  begin() {
    if (!this.ext || this.active || !this.gl) return;
    const gl = this.gl;
    this.active = gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active);
  }

  end() {
    if (!this.ext || !this.active || !this.gl) return;
    const gl = this.gl;
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  sample(): number | null {
    if (!this.ext || !this.gl) return null;
    const gl = this.gl;
    while (this.pending.length) {
      const query = this.pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      const nanoseconds = disjoint ? 0 : gl.getQueryParameter(query, gl.QUERY_RESULT);
      gl.deleteQuery(query);
      this.pending.shift();
      if (!disjoint) {
        this.history.push(nanoseconds / 1e6);
        if (this.history.length > 10) this.history.shift();
      }
    }
    if (!this.history.length) return null;
    return this.history.reduce((a, b) => a + b, 0) / this.history.length;
  }
}
