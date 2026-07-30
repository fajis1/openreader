// onnxruntime-node 1.18.0 publishes a `types` path but omits that generated
// declaration file from its npm package. Its public API is the shared runtime
// API, so bridge to the declarations shipped by onnxruntime-common.
declare module 'onnxruntime-node' {
  import * as onnxruntimeCommon from 'onnxruntime-common';
  export = onnxruntimeCommon;
}
