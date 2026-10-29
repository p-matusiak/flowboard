import { Handle, Position } from "@xyflow/react";

/** Full-edge hit areas so an arrow can start or end anywhere on the border. */
export function EdgeAnchors() {
  return (
    <>
      <Handle id="top" type="source" position={Position.Top} className="edge-anchor" />
      <Handle id="right" type="source" position={Position.Right} className="edge-anchor" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="edge-anchor" />
      <Handle id="left" type="source" position={Position.Left} className="edge-anchor" />
    </>
  );
}
