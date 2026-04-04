import React, { useRef, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useStore } from '../store/useStore';

interface Props {
  isMini?: boolean;
}

export const GraphView: React.FC<Props> = ({ isMini = false }) => {
  const { graphData, openFile, setViewMode } = useStore();
  const ref = useRef<any>(null);

  useEffect(() => {
    if (!ref.current) return;
    // d3Force('name') returns the force; then we configure it
    const charge = ref.current.d3Force('charge');
    if (charge) charge.strength(isMini ? -60 : -200);
    const link = ref.current.d3Force('link');
    if (link) link.distance(isMini ? 40 : 100);
  }, [isMini, ref.current]);

  const onNodeClick = (node: any) => {
    if (isMini) return;
    openFile(node.id);
    setViewMode('editor');
  };

  const nodeCanvasObject = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const r = isMini ? 3 : 5;
    // Node circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = '#a78bfa';
    ctx.fill();
    ctx.strokeStyle = 'rgba(124,109,255,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label (only in full view and large enough zoom)
    if (!isMini && globalScale >= 0.8) {
      const label = node.label as string;
      const fontSize = 11 / globalScale;
      ctx.font = `${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(232,232,232,0.85)';
      ctx.fillText(label, node.x, node.y + r + 3);
    }
  };

  if (!isMini) {
    return (
      <div className="graph-shell">
        <div className="graph-topbar">
          <span>Knowledge Graph — {graphData.nodes.length} notes, {graphData.links.length} connections</span>
        </div>
        <div className="graph-canvas">
          <ForceGraph2D
            ref={ref}
            graphData={graphData}
            nodeCanvasObject={nodeCanvasObject}
            nodeLabel="label"
            linkColor={() => 'rgba(124,109,255,0.25)'}
            linkWidth={1.5}
            backgroundColor="#161616"
            onNodeClick={onNodeClick}
            enableNodeDrag
            enablePanInteraction
            enableZoomInteraction
            width={undefined}
            height={undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <ForceGraph2D
        ref={ref}
        graphData={graphData}
        nodeColor={() => '#7c6dff'}
        linkColor={() => 'rgba(124,109,255,0.3)'}
        nodeRelSize={3}
        linkWidth={1}
        backgroundColor="transparent"
        enableNodeDrag={false}
        enablePanInteraction={false}
        enableZoomInteraction={false}
        width={undefined}
        height={undefined}
      />
    </div>
  );
};
