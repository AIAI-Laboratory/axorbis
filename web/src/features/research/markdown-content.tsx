import katex from "katex";
import "katex/dist/katex.min.css";
import { marked, type Token, type Tokens } from "marked";
import React, { createElement, useMemo, type ReactNode } from "react";

const FILE_PATH_PATTERN = /^(?:\.axorbis\/artifacts|outputs|papers|notes)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+$/;
const INLINE_FILE_PATH_PATTERN = /(?:\.axorbis\/artifacts|outputs|papers|notes)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g;
const MATH_MARKER = /@@AXORBIS_MATH:(display|inline):([^@]+)@@/g;
type InlineMatch =
	| { kind: "math"; start: number; end: number; display: boolean; latex: string }
	| { kind: "file"; start: number; end: number; path: string };

function mathMarker(latex: string, display: boolean): string {
	return `@@AXORBIS_MATH:${display ? "display" : "inline"}:${encodeURIComponent(latex)}@@`;
}

/**
 * Marked tokenizes TeX backslashes as Markdown escapes. Replace math spans
 * first, while leaving fenced and inline code untouched, then render their
 * inert markers after Markdown has produced its normal document structure.
 */
function preserveMath(content: string): string {
	return content.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g).map((part) => {
		if (part.startsWith("`") || part.startsWith("~~~")) return part;
		return part
			.replace(/\$\$([\s\S]+?)\$\$/g, (_match, latex: string) => mathMarker(latex.trim(), true))
			.replace(/\\\[([\s\S]+?)\\\]/g, (_match, latex: string) => mathMarker(latex.trim(), true))
			.replace(/\\\((.+?)\\\)/g, (_match, latex: string) => mathMarker(latex, false))
			.replace(/(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (_match, latex: string) => mathMarker(latex, false));
	}).join("");
}

function renderMath(latex: string, display: boolean, key: string): ReactNode {
	try {
		return <span key={key} className={display ? "rw-latex rw-latex-display" : "rw-latex"} dangerouslySetInnerHTML={{ __html: katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: "warn", trust: false }) }} />;
	} catch {
		return <code key={key}>{display ? `$$${latex}$$` : `$${latex}$`}</code>;
	}
}

function isFilePath(text: string): boolean {
	return FILE_PATH_PATTERN.test(text) && text.split("/").every((segment) => segment !== "." && segment !== "..");
}

function filePathControl(path: string, key: string, onFilePath: (path: string) => void): ReactNode {
	return <button type="button" key={key} className="rw-file-path-link" onClick={() => onFilePath(path)} title={`Open ${path}`}><span className="rw-file-path-icon">{"\uD83D\uDCC4"}</span>{path}</button>;
}

function renderTextWithFilePaths(value: string, key: string, onFilePath?: (path: string) => void): ReactNode {
	const matches: InlineMatch[] = [...value.matchAll(MATH_MARKER)].map((match) => ({
		kind: "math" as const,
		start: match.index ?? 0,
		end: (match.index ?? 0) + match[0].length,
		display: match[1] === "display",
		latex: decodeURIComponent(match[2] ?? ""),
	}));
	if (onFilePath) matches.push(...[...value.matchAll(INLINE_FILE_PATH_PATTERN)].filter((match) => isFilePath(match[0])).map((match) => ({
		kind: "file" as const,
		start: match.index ?? 0,
		end: (match.index ?? 0) + match[0].length,
		path: match[0],
	})));
	matches.sort((a, b) => a.start - b.start);
	if (!matches.length) return decodeText(value);
	const children: ReactNode[] = [];
	let offset = 0;
	for (const [index, match] of matches.entries()) {
		if (match.start < offset) continue;
		if (match.start > offset) children.push(decodeText(value.slice(offset, match.start)));
		children.push(match.kind === "math"
			? renderMath(match.latex, match.display, `${key}:math:${index}`)
			: filePathControl(match.path, `${key}:file:${index}`, onFilePath!));
		offset = match.end;
	}
	if (offset < value.length) children.push(decodeText(value.slice(offset)));
	return <>{children}</>;
}

function safeHref(value: string): string | undefined {
	try {
		const url = new URL(value, "https://axorbis.invalid");
		if (["https:", "http:", "mailto:"].includes(url.protocol)) return value;
		if (value.startsWith("/") || value.startsWith("#")) return value;
	} catch { /* An invalid link is shown as text. */ }
	return undefined;
}

function decodeText(value: string): string {
	const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d" };
	return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (source, entity: string) => {
		const key = entity.toLowerCase();
		if (key in named) return named[key];
		if (!key.startsWith("#")) return source;
		const codePoint = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
		return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff) ? String.fromCodePoint(codePoint) : source;
	});
}

function renderTokens(tokens: Token[], onFilePath?: (path: string) => void): ReactNode[] {
	return tokens.map((token, index) => {
		const key = `${index}:${token.type}`;
		const nested = (token as { tokens?: Token[] }).tokens ?? [];
		const value = (token as { text?: string }).text ?? token.raw;
		switch (token.type) {
			case "space":
			case "def": return null;
			case "heading": return createElement(`h${Math.min(6, Math.max(1, (token as Tokens.Heading).depth))}`, { key }, renderTokens(nested, onFilePath));
			case "paragraph": return <p key={key}>{renderTokens(nested, onFilePath)}</p>;
			case "text": return nested.length ? <span key={key}>{renderTokens(nested, onFilePath)}</span> : <React.Fragment key={key}>{renderTextWithFilePaths(value, key, onFilePath)}</React.Fragment>;
			case "escape": return decodeText(value);
			case "strong": return <strong key={key}>{renderTokens(nested, onFilePath)}</strong>;
			case "em": return <em key={key}>{renderTokens(nested, onFilePath)}</em>;
			case "del": return <del key={key}>{renderTokens(nested, onFilePath)}</del>;
			case "codespan": {
				if (onFilePath && isFilePath(value)) {
					return filePathControl(value, key, onFilePath);
				}
				return <code key={key}>{value}</code>;
			}
			case "code": return <pre key={key}><code>{value}</code></pre>;
			case "blockquote": return <blockquote key={key}>{renderTokens(nested, onFilePath)}</blockquote>;
			case "hr": return <hr key={key} />;
			case "br": return <br key={key} />;
			case "list": {
				const list = token as Tokens.List;
				const children = list.items.map((item, itemIndex) => <li key={itemIndex}>{item.task && <input type="checkbox" checked={Boolean(item.checked)} readOnly disabled aria-label="Checklist item" />}{renderTokens(item.tokens, onFilePath)}</li>);
				return list.ordered ? <ol key={key} start={list.start || 1}>{children}</ol> : <ul key={key}>{children}</ul>;
			}
			case "table": {
				const table = token as Tokens.Table;
				return <div className="rw-markdown-table-scroll" key={key}><table><thead><tr>{table.header.map((cell, cellIndex) => <th key={cellIndex} style={{ textAlign: cell.align ?? undefined }}>{renderTokens(cell.tokens, onFilePath)}</th>)}</tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} style={{ textAlign: cell.align ?? undefined }}>{renderTokens(cell.tokens, onFilePath)}</td>)}</tr>)}</tbody></table></div>;
			}
			case "link": {
				const link = token as Tokens.Link;
				const href = safeHref(link.href);
				return href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer" title={link.title ?? undefined}>{renderTokens(nested, onFilePath)}</a> : <span key={key}>{renderTokens(nested, onFilePath)}</span>;
			}
			case "image": {
				const image = token as Tokens.Image;
				const href = safeHref(image.href);
				return href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{image.text || "Image"}</a> : image.text;
			}
			case "html": return value;
			default: return nested.length ? <span key={key}>{renderTokens(nested, onFilePath)}</span> : token.raw;
		}
	});
}

export function MarkdownContent({ content, className = "", onFilePath }: { content: string; className?: string; onFilePath?: (path: string) => void }) {
	const tokens = useMemo(() => marked.lexer(preserveMath(content), { gfm: true }), [content]);
	return <div className={`rw-markdown ${className}`.trim()}>{renderTokens(tokens, onFilePath)}</div>;
}

export function readableResearchMessage(content: string): string {
	if (!content.trimStart().startsWith("{")) return content;
	try {
		const outer: unknown = JSON.parse(content);
		if (!outer || typeof outer !== "object" || !("error" in outer)) return content;
		const rawError = (outer as { error: unknown }).error;
		const error = typeof rawError === "string" && rawError.trimStart().startsWith("{") ? JSON.parse(rawError) as unknown : rawError;
		if (!error || typeof error !== "object" || !("message" in error)) return content;
		const message = (error as { message: unknown }).message;
		return typeof message === "string" ? `**Research request failed**\n\n${message}` : content;
	} catch { return content; }
}
