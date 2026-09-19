import { ArrowDownToLine, ArrowRight, BookOpen, ChevronDown, ChevronRight, FileText, RotateCcw, Search, Star, Trash2, X } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { FilePreview, WorkbenchArtifact, WorkbenchRun, WorkbenchState } from "../../app/types.js";
import { groupProjectFiles } from "./research-domain.js";
import { apiJson, workbenchApiUrl } from "./research-session.js";
import { MarkdownContent } from "./markdown-content.js";

type ArtifactAction = "delete" | "rename" | "restore" | "star" | "unstar";

function isMarkdown(file: WorkbenchArtifact): boolean {
	return file.extension.toLowerCase() === ".md" || file.contentType === "text/markdown";
}

function fileSize(bytes: number): string {
	return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function QuestionFileGroups({ groups, totals, navigateQuestion, showFiles, openPreview }: {
	groups: { question?: WorkbenchRun; files: WorkbenchArtifact[] }[];
	totals: { question?: WorkbenchRun; files: WorkbenchArtifact[] }[];
	navigateQuestion?: (question: WorkbenchRun) => void;
	showFiles: boolean;
	openPreview: (path: string, button: HTMLButtonElement) => void;
}) {
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set(showFiles ? groups.map((group) => group.question?.slug ?? "other") : []));
	function toggleGroup(key: string) {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key); else next.add(key);
			return next;
		});
	}
	return <div className="rw-question-file-groups">{groups.map((group, index) => {
		if (!showFiles && !group.question) return null;
		const key = group.question?.slug ?? "other";
		const total = totals[index]?.files.length ?? group.files.length;
		const isOpen = expanded.has(key);
		return <section className="rw-question-file-group" key={key}>
			<div className="rw-question-file-head">
				{showFiles && <button type="button" className="rw-question-file-toggle" onClick={() => toggleGroup(key)} aria-expanded={isOpen} aria-label={isOpen ? "Collapse file list" : "Expand file list"}>
					{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</button>}
				{group.question ? <button type="button" className="rw-question-file-title" onClick={() => showFiles ? toggleGroup(key) : navigateQuestion?.(group.question!)} aria-expanded={showFiles ? isOpen : undefined}><span className="rw-row-mark"><BookOpen size={15} /></span><span><strong>{group.question.title}</strong><small>ID · {group.question.slug}</small></span></button> : <div className="rw-question-file-title rw-question-file-other"><span className="rw-row-mark"><FileText size={15} /></span><span><strong>Other project files</strong><small>Files not linked to a specific question</small></span></div>}
				<span className="rw-question-file-count">{total} {total === 1 ? "file" : "files"}</span>
			</div>
			{showFiles && isOpen && (group.files.length ? <div className="rw-question-file-list">{group.files.map((file) => <button type="button" key={file.path} onClick={(event) => openPreview(file.path, event.currentTarget)}><FileText size={14} /><span><strong>{file.displayName ?? file.title}</strong><small>{file.path}</small></span><span className="rw-question-file-meta">{file.starred && <Star size={12} fill="currentColor" aria-label="Starred" />}{fileSize(file.sizeBytes)}</span></button>)}</div> : <p className="rw-question-file-empty">No files for this question yet.</p>)}
		</section>;
	})}</div>;
}
export function ProjectFiles({ files, questions, navigateQuestion, newQuestion, onState, onError, showFiles = false }: {
	files: WorkbenchArtifact[];
	questions: WorkbenchRun[];
	navigateQuestion?: (question: WorkbenchRun) => void;
	newQuestion: () => void;
	onState: (state: WorkbenchState) => void;
	onError: (message: string) => void;
	showFiles?: boolean;
}) {
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [preview, setPreview] = useState<FilePreview | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [renaming, setRenaming] = useState(false);
	const [displayName, setDisplayName] = useState("");
	const [busy, setBusy] = useState(false);
	const [undo, setUndo] = useState<{ path: string; name: string } | null>(null);
	const [contentSearch, setContentSearch] = useState("");
	const closeButton = useRef<HTMLButtonElement>(null);
	const openedFrom = useRef<HTMLButtonElement | null>(null);
	const searchInput = useRef<HTMLInputElement>(null);
	const groups = useMemo(() => groupProjectFiles(files, questions), [files, questions]);
	const totals = useMemo(() => groupProjectFiles(files, questions), [files, questions]);
	const selected = files.find((file) => file.path === selectedPath);

	useEffect(() => {
		if (selectedPath && !selected) setSelectedPath(null);
	}, [selectedPath, selected]);
	useEffect(() => {
		setRenaming(false);
		setDisplayName(selected?.displayName ?? selected?.title ?? "");
		setContentSearch("");
		if (selected) closeButton.current?.focus();
	}, [selected?.path]);
	useEffect(() => {
		if (!selected) return;
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") { event.preventDefault(); setSelectedPath(null); openedFrom.current?.focus(); }
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && selected) {
				event.preventDefault();
				searchInput.current?.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [selected?.path]);
	useEffect(() => {
		if (!selected?.previewable || selected.contentType === "application/pdf") {
			setPreview(null); setPreviewError(null); return;
		}
		let active = true;
		setPreview(null); setPreviewError(null);
		void apiJson<FilePreview>(`/api/file?path=${encodeURIComponent(selected.path)}`)
			.then((file) => { if (active) setPreview(file); })
			.catch((cause) => { if (active) setPreviewError(cause instanceof Error ? cause.message : String(cause)); });
		return () => { active = false; };
	}, [selected?.path, selected?.previewable, selected?.contentType]);

	function closePreview() {
		setSelectedPath(null);
		openedFrom.current?.focus();
	}
	function openPreview(path: string, button: HTMLButtonElement) {
		openedFrom.current = button;
		setSelectedPath(path);
	}
	async function act(path: string, action: ArtifactAction, nextName?: string): Promise<boolean> {
		setBusy(true);
		try {
			const result = await apiJson<{ state: WorkbenchState }>("/api/artifact/action", {
				artifactPath: path, action, ...(nextName === undefined ? {} : { displayName: nextName }),
			});
			onState(result.state);
			if (action === "restore") setUndo(null);
			if (action === "rename") setRenaming(false);
			return true;
		} catch (cause) { onError(cause instanceof Error ? cause.message : String(cause)); return false; }
		finally { setBusy(false); }
	}
	function submitRename(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (selected && displayName.trim()) void act(selected.path, "rename", displayName.trim());
	}
	function remove() {
		if (!selected || !window.confirm(`Move "${selected.displayName ?? selected.title}" to trash? You can undo this action.`)) return;
		const deleted = { path: selected.path, name: selected.displayName ?? selected.title };
		void act(selected.path, "delete").then((ok) => { if (ok) { setUndo(deleted); closePreview(); } });
	}

	const matchCount = useMemo(() => {
		if (!contentSearch.trim() || !preview?.content) return 0;
		const needle = contentSearch.trim().toLowerCase();
		let count = 0;
		let idx = 0;
		const hay = preview.content.toLowerCase();
		while ((idx = hay.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
		return count;
	}, [contentSearch, preview?.content]);

	return <section className="rw-project-files" aria-label="Research questions and files">
		<div className="rw-section-head rw-project-files-heading"><h2>Research questions</h2></div>
		{undo && <div className="rw-file-undo" role="status"><span>Moved &ldquo;{undo.name}&rdquo; to trash.</span><button type="button" onClick={() => void act(undo.path, "restore")} disabled={busy}><RotateCcw size={13} /> Undo</button></div>}
	{questions.length || files.length ? <QuestionFileGroups groups={groups} totals={totals} navigateQuestion={navigateQuestion} showFiles={showFiles} openPreview={openPreview} /> : <div className="rw-soft-empty"><strong>No research questions yet.</strong> Add a question to start collecting research files. <button type="button" className="rw-text-action" onClick={newQuestion}>Add question <ArrowRight size={14} /></button></div>}
		{selected && <div className="rw-file-viewer-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closePreview(); }}><aside className="rw-file-viewer" role="dialog" aria-modal="true" aria-label={`File: ${selected.displayName ?? selected.title}`}>
			<div className="rw-file-viewer-top"><span>PROJECT FILE</span><button ref={closeButton} type="button" aria-label="Close file preview" onClick={closePreview}><X size={15} /></button></div>
			{preview?.content && <div className="rw-file-viewer-search">
				<Search size={14} />
				<input ref={searchInput} type="search" value={contentSearch} onChange={(event) => setContentSearch(event.target.value)} placeholder="Search in file… (⌘F)" aria-label="Search in file content" />
				{contentSearch.trim() && <span className="rw-file-viewer-match-count">{matchCount} {matchCount === 1 ? "match" : "matches"}</span>}
				{contentSearch && <button type="button" aria-label="Clear search" onClick={() => setContentSearch("")}><X size={13} /></button>}
			</div>}
			<div className="rw-file-viewer-body"><div className="rw-project-file-detail-head"><div><span className="rw-kicker">{selected.category.toUpperCase()}</span><h3>{selected.displayName ?? selected.title}</h3><p>{selected.path}</p></div><span>{fileSize(selected.sizeBytes)}</span></div>
				<div className="rw-project-file-actions"><button type="button" onClick={() => void act(selected.path, selected.starred ? "unstar" : "star")} disabled={busy}><Star size={14} fill={selected.starred ? "currentColor" : "none"} /> {selected.starred ? "Unstar" : "Star"}</button><button type="button" onClick={() => setRenaming((value) => !value)} disabled={busy}>Edit display name</button><a href={workbenchApiUrl(`/api/file/download?path=${encodeURIComponent(selected.path)}`)}><ArrowDownToLine size={14} /> Download</a><button type="button" className="rw-file-delete" onClick={remove} disabled={busy}><Trash2 size={14} /> Move to trash</button></div>
				{renaming && <form className="rw-project-file-rename" onSubmit={submitRename}><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={180} aria-label="File display name" autoFocus /><button type="submit" disabled={busy || !displayName.trim()}>Save name</button><button type="button" onClick={() => setRenaming(false)}>Cancel</button></form>}
				<div className="rw-project-file-preview"><span className="rw-kicker">PREVIEW</span>{previewError ? <p className="rw-file-preview-status">Preview unavailable: {previewError}</p> : selected.contentType === "application/pdf" ? <p className="rw-file-preview-status">PDF preview is not available here. Download the file to read it.</p> : !selected.previewable ? <p className="rw-file-preview-status">This file type has no text preview. Download it to open it.</p> : !preview ? <p className="rw-file-preview-status">Loading preview…</p> : isMarkdown(selected) ? <HighlightedMarkdown content={preview.content} search={contentSearch} /> : <HighlightedPre content={preview.content} search={contentSearch} />}{preview?.truncated && <p className="rw-file-preview-status">Preview shortened. Download the file to see the full content.</p>}</div>
			</div>
		</aside></div>}
	</section>;
}

function highlightText(text: string, search: string): React.ReactNode[] {
	if (!search.trim()) return [text];
	const needle = search.trim().toLowerCase();
	const parts: React.ReactNode[] = [];
	let cursor = 0;
	let idx: number;
	const lower = text.toLowerCase();
	while ((idx = lower.indexOf(needle, cursor)) !== -1) {
		if (idx > cursor) parts.push(text.slice(cursor, idx));
		parts.push(<mark key={idx} className="rw-search-highlight">{text.slice(idx, idx + needle.length)}</mark>);
		cursor = idx + needle.length;
	}
	if (cursor < text.length) parts.push(text.slice(cursor));
	return parts;
}

function HighlightedPre({ content, search }: { content: string; search: string }) {
	return <pre className="rw-file-preview">{highlightText(content, search)}</pre>;
}

function HighlightedMarkdown({ content, search }: { content: string; search: string }) {
	if (!search.trim()) return <MarkdownContent content={content} />;
	// When searching, render as plain text with highlights so matches are visible
	return <div className="rw-inspector-markdown rw-search-plain"><pre className="rw-file-preview">{highlightText(content, search)}</pre></div>;
}
