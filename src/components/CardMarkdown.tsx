import React, { useMemo } from 'react';
import MarkdownIt from 'markdown-it';

/* Card faces render markdown (bold, code, lists, …) — html disabled, so
   note content can't inject markup into the review UI. */
const md = new MarkdownIt({ html: false, linkify: false, breaks: true });

export const CardMarkdown: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const html = useMemo(() => md.render(text ?? ''), [text]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};
