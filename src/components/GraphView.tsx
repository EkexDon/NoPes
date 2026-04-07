import React, { useRef, useEffect, useState, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useStore } from '../store/useStore';

interface Props {
  isMini?: boolean;
}

const COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#f472b6', '#38bdf8', '#818cf8'];

export const GraphView: React.FC<Props> = ({ isMini = false }) => {
  const { graphData, openFile, setViewMode, createNodeFromGraph } = useStore();
  const ref = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const clickTimeout = useRef<number>(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        const newW = Math.floor(entry.contentRect.width);
        const newH = Math.floor(entry.contentRect.height);
        
        setDimensions(prev => {
          if (prev.width === newW && prev.height === newH) return prev;
          return { width: newW, height: newH };
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    graphData.nodes.forEach(n => (n.tags || []).forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [graphData.nodes]);
  
  const filteredData = useMemo(() => {
    if (!activeTag) return graphData;
    const nodes = graphData.nodes.filter(n => (n.tags || []).includes(activeTag));
    const nodeIds = new Set(nodes.map(n => n.id));
    const links = graphData.links.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target));
    return { nodes, links };
  }, [graphData, activeTag]);

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
    
    // Choose color based on first tag
    let color = '#a78bfa'; // default
    if (node.tags && node.tags.length > 0) {
      let hash = 0;
      for (let i = 0; i < node.tags[0].length; i++) hash = node.tags[0].charCodeAt(i) + ((hash << 5) - hash);
      color = COLORS[Math.abs(hash) % COLORS.length];
    }
    
    const isMuted = activeTag && !(node.tags || []).includes(activeTag);
    ctx.globalAlpha = isMuted ? 0.15 : 1.0;

    // Node circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = `rgba(min(255, red+50), min(255, green+50), min(255, blue+50), 0.4)`; // hack for generic stroke mapping
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label
    if (!isMini && globalScale >= 0.8 && !isMuted) {
      const label = node.label as string;
      const fontSize = 11 / globalScale;
      ctx.font = `${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(232,232,232,0.85)';
      ctx.fillText(label, node.x, node.y + r + 3);
    }
    ctx.globalAlpha = 1.0; // reset
  };
  
  const handleBackgroundClick = () => {
    if (isMini) return;
    const now = Date.now();
    if (now - clickTimeout.current < 300) {
      createNodeFromGraph();
      clickTimeout.current = 0;
    } else {
      clickTimeout.current = now;
    }
  };

  if (!isMini) {
    return (
      <div className="graph-shell">
        <div className="graph-topbar" style={{ display: 'flex', flexDirection: 'column', height: 'auto', padding: '10px 20px', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <span>Knowledge Graph — {filteredData.nodes.length} notes, {filteredData.links.length} connections {activeTag ? `(filtered by #${activeTag})` : ''}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--tx-3)' }}>Double-click empty space to create note</span>
          </div>
          {allTags.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button 
                onClick={() => setActiveTag(null)}
                style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: !activeTag ? 'var(--accent)' : 'var(--bg-3)', color: !activeTag ? '#fff' : 'var(--tx-2)' }}
              >
                All
              </button>
              {allTags.map(tag => (
                <button 
                  key={tag} 
                  onClick={() => setActiveTag(tag)}
                  style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: activeTag === tag ? 'var(--accent)' : 'var(--bg-3)', color: activeTag === tag ? '#fff' : 'var(--tx-2)' }}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="graph-canvas" ref={containerRef}>
          <ForceGraph2D
            ref={ref}
            graphData={graphData} /* feed full data to maintain shape, but visually mute inactive parts */
            nodeCanvasObject={nodeCanvasObject}
            nodeLabel="label"
            linkColor={(link: any) => {
               if (!activeTag) return 'rgba(124,109,255,0.25)';
               const sHas = (link.source.tags || []).includes(activeTag);
               const tHas = (link.target.tags || []).includes(activeTag);
               return (sHas || tHas) ? 'rgba(124,109,255,0.25)' : 'rgba(124,109,255,0.05)';
            }}
            linkWidth={1.5}
            backgroundColor="#161616"
            onNodeClick={onNodeClick}
            onBackgroundClick={handleBackgroundClick}
            enableNodeDrag
            enablePanInteraction
            enableZoomInteraction
            width={dimensions.width || 800}
            height={dimensions.height || 600}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }} ref={containerRef}>
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
        width={dimensions.width || 300}
        height={dimensions.height || 150}
      />
    </div>
  );
};
