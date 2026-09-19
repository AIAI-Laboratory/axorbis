import {
	ArrowRight, ArrowUp, BookOpen, Check, ChevronRight, Command, FileText, FolderOpen,
	Home, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Square, StickyNote, Sun, X,
	Settings,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import type {
	FilePreview, WorkbenchArtifact, WorkbenchChatSession, WorkbenchGeneratedPlan,
	WorkbenchProject, WorkbenchResearchClaim, WorkbenchRun, WorkbenchState,
} from "./types.js";
import { projectArtifacts, projectQuestions, questionArtifacts, questionClaims, researchPath } from "../features/research/research-domain.js";
import { MarkdownContent, readableResearchMessage } from "../features/research/markdown-content.js";
import { ProjectFiles } from "../features/research/project-files.js";
import { apiJson, awaitingDeepResearchApproval, MODE_LABELS, streamResearchMessage, type ResearchMode } from "../features/research/research-session.js";
import { AiProviders, type AiProviderRecord, type AiProviderSaveInput, type AiProviderTestInput } from "../features/settings/ai-providers.js";
import { ResearchAccess, type ResearchAccessStatus, type SearchProvider } from "../features/settings/research-access.js";
import type { ReleaseAnnouncement, ReleaseCheck } from "../../../engine/workbench/update-announcement.js";
import "../styles/research-app.css";
import "../styles/research-system.css";

type Theme = "light" | "dark" | "system";
type Page = { kind: "home" } | { kind: "projects" } | { kind: "notes" } | { kind: "settings" } | { kind: "project"; projectId: string } | { kind: "question"; projectId: string; runSlug: string };
type View = "overview" | "sources" | "claims" | "activity";
type Selection = { kind: "claim"; id: string } | { kind: "artifact"; path: string } | null;
type ProviderConnection = { status: "connected" | "error"; detail: string };
type NoteChecklistItem = { id: string; text: string; done: boolean };
type WorkbenchNote = { id: string; title: string; items: NoteChecklistItem[]; updatedAt: number };

function createLocalId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseNotes(value: string): WorkbenchNote[] {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((entry): WorkbenchNote[] => {
			if (!entry || typeof entry !== "object") return [];
			const candidate = entry as Partial<WorkbenchNote>;
			if (typeof candidate.id !== "string" || typeof candidate.title !== "string" || !Array.isArray(candidate.items)) return [];
			const items = candidate.items.flatMap((item): NoteChecklistItem[] => {
				if (!item || typeof item !== "object") return [];
				const checklistItem = item as Partial<NoteChecklistItem>;
				return typeof checklistItem.id === "string" && typeof checklistItem.text === "string"
					? [{ id: checklistItem.id, text: checklistItem.text, done: checklistItem.done === true }]
					: [];
			});
			return [{ id: candidate.id, title: candidate.title, items, updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now() }];
		});
	} catch { return []; }
}

function pageFromPath(pathname: string): Page {
	const parts = pathname.split("/").filter(Boolean);
	try {
		if (parts[0] === "notes") return { kind: "notes" };
		if (parts[0] === "settings" && parts[1] === "ai-providers") return { kind: "settings" };
		if (parts[0] === "app-shell" && parts[1] === "projects" && parts[2] && parts[3] === "frames" && parts[4]) {
			return { kind: "question", projectId: decodeURIComponent(parts[2]), runSlug: decodeURIComponent(parts[4]) };
		}
		if (parts[0] === "projects" && parts[1] && parts[2] === "questions" && parts[3]) {
			return { kind: "question", projectId: decodeURIComponent(parts[1]), runSlug: decodeURIComponent(parts[3]) };
		}
		if (parts[0] === "projects" && parts[1]) return { kind: "project", projectId: decodeURIComponent(parts[1]) };
	} catch { return { kind: "projects" }; }
	return parts[0] === "projects" ? { kind: "projects" } : { kind: "home" };
}

function usePreference<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
	const read = () => {
		try { return (localStorage.getItem(key) as T | null) ?? fallback; } catch { return fallback; }
	};
	const [value, setValue] = useState<T>(read);
	useEffect(() => setValue(read()), [key]);
	return [value, (next) => {
		setValue(next);
		try { localStorage.setItem(key, next); } catch { /* Browsing remains available without storage. */ }
	}];
}

function formattedDate(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "Recently" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function IconButton({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean }) {
	return <button type="button" className="rw-icon-button" aria-label={label} aria-pressed={pressed} title={label} onClick={onClick}>{children}</button>;
}

function Empty({ title, detail, action, onClick }: { title: string; detail: string; action?: ReactNode; onClick?: () => void }) {
	const content = <><span className="rw-empty-mark" aria-hidden="true"><Plus size={16} /></span><h3>{title}</h3><p>{detail}</p>{action}</>;
	return onClick ? <button type="button" className="rw-empty rw-empty-clickable" onClick={onClick}>{content}</button> : <div className="rw-empty">{content}</div>;
}

export function ResearchApp() {
	const [state, setState] = useState<WorkbenchState | null>(null);
	const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
	const [session, setSession] = useState<WorkbenchChatSession | null>(null);
	const [preview, setPreview] = useState<FilePreview | null>(null);
	const [selection, setSelection] = useState<Selection>(null);
	const [view, setView] = useState<View>("overview");
	const [mode, setMode] = useState<ResearchMode>("ask");
	const [draft, setDraft] = useState("");
	const [newTitle, setNewTitle] = useState("");
	const [dialog, setDialog] = useState<"project" | "question" | null>(null);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [paletteQuery, setPaletteQuery] = useState("");
	const [mobileNav, setMobileNav] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [update, setUpdate] = useState<ReleaseAnnouncement | null>(null);
	const [dismissedUpdate, setDismissedUpdate] = usePreference<string>("axorbis.update.dismissed", "");
	const [homeNote, setHomeNote] = usePreference<string>("axorbis.home.note", "");
	const [notesValue, setNotesValue] = usePreference<string>("axorbis.notes", "[]");
	const notes = useMemo(() => parseNotes(notesValue), [notesValue]);
	const notesMigrated = useRef(false);
	const [busy, setBusy] = useState(false);
	const [creating, setCreating] = useState(false);
	const [theme, setTheme] = usePreference<Theme>("feynman.research.theme", "system");
	const [savingProviderId, setSavingProviderId] = useState<string>();
	const [testingProviderId, setTestingProviderId] = useState<string>();
	const [providerConnections, setProviderConnections] = useState<Record<string, ProviderConnection>>({});
	const [researchAccess, setResearchAccess] = useState<ResearchAccessStatus | null>(null);
	const [savingResearchAccess, setSavingResearchAccess] = useState(false);
	const [connectingAlpha, setConnectingAlpha] = useState(false);
	const [sidebar, setSidebar] = usePreference<"open" | "closed">("feynman.research.sidebar", "open");
	const projectId = page.kind === "project" || page.kind === "question" ? page.projectId : "workspace";
	const [tree, setTree] = usePreference<"open" | "closed">(`feynman.research.tree.${projectId}`, "open");
	const paletteInput = useRef<HTMLInputElement>(null);
	const composerInput = useRef<HTMLTextAreaElement>(null);
	const setupRedirected = useRef(false);

	useEffect(() => {
		let active = true;
		void apiJson<WorkbenchState>("/api/state").then((data) => { if (active) setState(data); }).catch((cause) => { if (active) setError(String(cause)); });
		return () => { active = false; };
	}, []);
	useEffect(() => {
		let active = true;
		void apiJson<ResearchAccessStatus>("/api/research-access").then((data) => { if (active) setResearchAccess(data); }).catch((cause) => { if (active) setError(String(cause)); });
		return () => { active = false; };
	}, []);
	useEffect(() => {
		let active = true;
		const check = () => {
			if (document.visibilityState === "hidden") return;
			void apiJson<ReleaseCheck>("/api/update").then((result) => {
				if (active) setUpdate(result.update);
			}).catch(() => { /* Update checks never block research. */ });
		};
		check();
		const interval = window.setInterval(check, 6 * 60 * 60_000);
		document.addEventListener("visibilitychange", check);
		return () => { active = false; window.clearInterval(interval); document.removeEventListener("visibilitychange", check); };
	}, []);
	useEffect(() => {
		const onPopState = () => { setPage(pageFromPath(window.location.pathname)); setSelection(null); };
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);
	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault(); setPaletteOpen((current) => !current);
			}
			if (event.key === "Escape") { setPaletteOpen(false); setDialog(null); setMobileNav(false); setSelection(null); }
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
	useEffect(() => { if (paletteOpen) paletteInput.current?.focus(); }, [paletteOpen]);
	useEffect(() => {
		if (notesMigrated.current || notes.length || !homeNote.trim()) return;
		const items = homeNote.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ id: createLocalId("item"), text, done: false }));
		setNotesValue(JSON.stringify([{ id: createLocalId("note"), title: "Quick note", items: items.length ? items : [{ id: createLocalId("item"), text: homeNote.trim(), done: false }], updatedAt: Date.now() }]));
		notesMigrated.current = true;
	}, [homeNote, notes, setNotesValue]);
	useEffect(() => {
		const media = window.matchMedia("(max-width: 850px)");
		const closeTree = () => { if (media.matches) setTree("closed"); };
		closeTree(); media.addEventListener("change", closeTree);
		return () => media.removeEventListener("change", closeTree);
	}, [projectId]);

	const projects = useMemo(() => state?.projects.filter((item) => item.kind === "custom").sort((a, b) => b.updatedAtMs - a.updatedAtMs) ?? [], [state]);
	const project = state && (page.kind === "project" || page.kind === "question") ? state.projects.find((item) => item.id === page.projectId) : undefined;
	const questions = state && project ? projectQuestions(state, project) : [];
	const question = page.kind === "question"
		? questions.find((item) => item.slug === page.runSlug) ?? state?.runs.find((item) => item.slug === page.runSlug && (item.projectId === page.projectId || project?.runSlugs.includes(item.slug)))
		: undefined;
	const claims = state && question ? questionClaims(state, question) : [];
	const artifacts = state && question ? questionArtifacts(state, question) : [];
	const plan = state && question ? state.plans.filter((item) => item.sessionId === question.slug || item.runSlug === question.slug).at(-1) : undefined;
	const recent = state ? projects.flatMap((item) => projectQuestions(state, item).map((run) => ({ project: item, run }))).sort((a, b) => b.run.updatedAtMs - a.run.updatedAtMs) : [];
	const selectedClaim = selection?.kind === "claim" ? claims.find((item) => item.id === selection.id) : undefined;
	const selectedArtifact = selection?.kind === "artifact" ? state?.artifacts.find((item) => item.path === selection.path) : undefined;

	useEffect(() => {
		if (!project || !question) { setSession(null); return; }
		let active = true;
		setSession(null);
		void apiJson<{ session: WorkbenchChatSession }>("/api/chat/session", { sessionId: question.slug, projectId: project.id, title: question.title })
			.then((result) => { if (active) setSession(result.session); })
			.catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
		return () => { active = false; };
	}, [project?.id, question?.slug, question?.title]);
	useEffect(() => {
		if (!state || !question) return;
		const linkedPath = new URLSearchParams(window.location.search).get("artifact");
		if (linkedPath && state.artifacts.some((item) => item.path === linkedPath)) {
			setSelection({ kind: "artifact", path: linkedPath });
			window.history.replaceState(null, "", researchPath(projectId, question.slug));
		}
	}, [state, question?.slug]);
	useEffect(() => {
		if (!selectedArtifact?.previewable || selectedArtifact.contentType === "application/pdf") { setPreview(null); return; }
		let active = true;
		setPreview(null);
		void apiJson<FilePreview>(`/api/file?path=${encodeURIComponent(selectedArtifact.path)}`)
			.then((file) => { if (active) setPreview(file); })
			.catch(() => { if (active) setPreview(null); });
		return () => { active = false; };
	}, [selectedArtifact?.path]);

	function navigate(path: string) {
		window.history.pushState(null, "", path);
		setPage(pageFromPath(path)); setView("overview"); setSelection(null);
		setPaletteOpen(false); setMobileNav(false);
	}
	useEffect(() => {
		// `feynman setup` is an interactive terminal flow. In the desktop app the
		// equivalent safe flow is to open the provider form, where credentials stay
		// in the backend vault and never need to pass through the browser.
		const configuredProviderModel = state?.aiProviders?.some((provider) => Boolean(provider.defaultModel && (provider.kind === "ollama" || provider.kind === "lm-studio" || provider.credentialRoles.inference?.configured)));
		if (setupRedirected.current || !state || page.kind !== "home" || state.modelStatus?.currentValid || configuredProviderModel) return;
		setupRedirected.current = true;
		navigate("/settings/ai-providers");
	}, [state?.modelStatus?.currentValid, state?.aiProviders, page.kind]);
	function openDialog(kind: "project" | "question") { setNewTitle(""); setDialog(kind); setPaletteOpen(false); }
	async function createItem(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const title = newTitle.trim();
		if (!title || creating) return;
		setCreating(true); setError(null);
		try {
			if (dialog === "project") {
				const result = await apiJson<{ project: WorkbenchProject; state: WorkbenchState }>("/api/project/new", { name: title });
				setDialog(null); setState(result.state); navigate(researchPath(result.project.id));
			} else if (dialog === "question") {
				if (!project) throw new Error("Open a project before adding a question.");
				const result = await apiJson<{ session: WorkbenchChatSession; state: WorkbenchState }>("/api/chat/session/new", { projectId: project.id, title });
				const nextState = result.state.runs.some((run) => run.slug === result.session.id)
					? result.state
					: await apiJson<WorkbenchState>("/api/state");
				setDialog(null); setState(nextState); navigate(researchPath(project.id, result.session.id));
			}
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { setCreating(false); }
	}
	async function sendResearch() {
		let text = draft.trim();
		if (!project || !question || busy) return;
		// When the composer is empty and a workflow mode is selected, auto-use the question title
		if (!text && mode !== "ask") text = question.title;
		if (!text) return;
		setBusy(true); setError(null); setDraft(""); setView("activity");
		const id = question.slug;
		try {
			const existing = session ?? (await apiJson<{ session: WorkbenchChatSession }>("/api/chat/session", { sessionId: id, projectId: project.id, title: question.title })).session;
			const timestamp = new Date().toISOString();
			setSession({ ...existing, status: "running", messages: [...existing.messages,
				{ id: `local-user-${Date.now()}`, role: "user", content: text, createdAt: timestamp, status: "complete", toolEvents: [] },
				{ id: `local-assistant-${Date.now()}`, role: "assistant", content: "Starting research…", createdAt: timestamp, status: "running", toolEvents: [] },
			] });
			await streamResearchMessage({ sessionId: id, projectId: project.id, title: question.title, text, mode, continuePlan: awaitingDeepResearchApproval(existing) }, {
				onSession: (update) => setSession((current) => current?.id === id ? update(current) : current),
				onState: setState,
			});
			setState(await apiJson<WorkbenchState>("/api/state"));
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { setBusy(false); }
	}
	async function stopResearch() {
		if (!project || !question) return;
		try {
			const result = await apiJson<{ session: WorkbenchChatSession }>("/api/chat/abort", { sessionId: question.slug, projectId: project.id, title: question.title });
			setSession(result.session); setBusy(false);
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
	}
	function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendResearch(); }
	}
	function selectArtifact(path: string) { setSelection({ kind: "artifact", path }); }
	const aiProviderRecords: AiProviderRecord[] = (state?.aiProviders ?? []).map((provider) => ({
		id: provider.id,
		kind: provider.kind,
		name: provider.name,
		endpoint: provider.endpoint,
		defaultModel: provider.defaultModel,
		inferenceKeyConfigured: provider.credentialRoles.inference?.configured ?? false,
		usageKeyConfigured: provider.credentialRoles.usage_admin?.configured ?? false,
		supportsInferenceKey: provider.kind !== "lm-studio" && provider.kind !== "ollama",
		supportsUsageKey: provider.kind === "anthropic" || provider.kind === "openai" || provider.kind === "openrouter" || provider.kind === "litellm",
		budget: provider.budget,
		usage: {
			inputTokens: provider.usage.inputTokens,
			outputTokens: provider.usage.outputTokens,
			estimatedCostUsd: provider.usage.estimatedCostUsd,
			providerReportedCostUsd: provider.usage.providerReportedCostUsd,
			monthCostUsd: provider.usage.monthCostUsd,
			warning: provider.usage.warning,
			hardStopped: provider.usage.hardStopped,
		},
		resourceLimits: provider.resourceLimits ? {
			contextTokens: provider.resourceLimits.contextWindow,
			cpuCores: provider.resourceLimits.cpuCores,
			memoryMb: provider.resourceLimits.memoryMb,
			gpuCount: provider.resourceLimits.gpuCount,
		} : undefined,
		connectionStatus: providerConnections[provider.id]?.status ?? "untested",
		connectionDetail: providerConnections[provider.id]?.detail,
	}));
	async function saveAiProvider(input: AiProviderSaveInput) {
		setSavingProviderId(input.id); setError(null);
		try {
			const record = {
				id: input.id, kind: input.kind, name: input.name, endpoint: input.endpoint, defaultModel: input.defaultModel,
				...(input.inferenceApiKey !== undefined ? { inferenceApiKey: input.inferenceApiKey } : input.clearInferenceApiKey ? { inferenceApiKey: "" } : {}),
				...(input.usageApiKey !== undefined ? { usageAdminApiKey: input.usageApiKey } : input.clearUsageApiKey ? { usageAdminApiKey: "" } : {}),
				budget: input.budget,
				...(input.resourceLimits ? { resourceLimits: {
					contextWindow: input.resourceLimits.contextTokens,
					cpuCores: input.resourceLimits.cpuCores,
					memoryMb: input.resourceLimits.memoryMb,
					gpuCount: input.resourceLimits.gpuCount,
				} } : {}),
			};
			const result = await apiJson<{ state: WorkbenchState }>("/api/ai-providers", { action: "upsert", record });
			setState(result.state);
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { setSavingProviderId(undefined); }
	}
	async function testAiProvider(input: AiProviderTestInput) {
		setTestingProviderId(input.id); setError(null);
		try {
			// A newly typed key is saved first; it is never kept in browser storage or rendered back.
			if (input.inferenceApiKey !== undefined || input.usageApiKey !== undefined) await saveAiProvider({ ...input, name: aiProviderRecords.find((item) => item.id === input.id)?.name ?? input.kind });
			const result = await apiJson<{ result: { detail: string; ok: boolean }; state: WorkbenchState }>("/api/ai-providers", { action: "test", id: input.id });
			setState(result.state);
			setProviderConnections((current) => ({ ...current, [input.id]: { status: result.result.ok ? "connected" : "error", detail: result.result.detail } }));
			if (!result.result.ok) setError(result.result.detail);
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { setTestingProviderId(undefined); }
	}
	async function removeAiProvider(id: string) {
		setSavingProviderId(id); setError(null);
		try {
			const result = await apiJson<{ state: WorkbenchState }>("/api/ai-providers", { action: "remove", id });
			setState(result.state);
			setProviderConnections((current) => { const next = { ...current }; delete next[id]; return next; });
		}
		catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { setSavingProviderId(undefined); }
	}
	async function saveSearch(input: { provider: SearchProvider; apiKey?: string }) {
		setSavingResearchAccess(true); setError(null);
		try {
			const result = await apiJson<{ search: ResearchAccessStatus["search"] }>("/api/search", { action: "upsert", ...input });
			setResearchAccess((current) => current ? { ...current, search: result.search } : current);
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { setSavingResearchAccess(false); }
	}
	async function connectAlpha() {
		setConnectingAlpha(true); setError(null);
		try {
			const result = await apiJson<{ auth: ResearchAccessStatus["alpha"] }>("/api/alpha-auth", { action: "login" });
			setResearchAccess((current) => current ? { ...current, alpha: result.auth } : current);
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { setConnectingAlpha(false); }
	}
	function updateNotes(next: WorkbenchNote[]) {
		setNotesValue(JSON.stringify(next));
	}

	const paletteItems = [
		{ label: "Home", detail: "Workspace", action: () => navigate("/") },
		{ label: "Projects", detail: "All projects", action: () => navigate("/projects") },
		{ label: "Notes", detail: "Checklist", action: () => navigate("/notes") },
		{ label: "Research access", detail: "Search and alphaXiv settings", action: () => navigate("/settings/ai-providers") },
		{ label: "AI providers", detail: "Settings", action: () => navigate("/settings/ai-providers") },
		{ label: "New project", detail: "Create", action: () => openDialog("project") },
		...(project ? [{ label: "New research question", detail: project.name, action: () => openDialog("question") }] : []),
		...(question ? [{ label: "Start deep research", detail: question.title, action: () => { setMode("deep"); setPaletteOpen(false); composerInput.current?.focus(); } }] : []),
		...projects.map((item) => ({ label: item.name, detail: "Project", action: () => navigate(researchPath(item.id)) })),
		...recent.map(({ project: item, run }) => ({ label: run.title, detail: item.name, action: () => navigate(researchPath(item.id, run.slug)) })),
	].filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(paletteQuery.toLowerCase().trim())).slice(0, 12);

	return <div className="rw-app" data-theme={theme}>
		<header className="rw-topbar">
			<div className="rw-brand"><IconButton label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={19} /></IconButton><span className="rw-brand-icon">A</span><strong>AXORBIS</strong><span className="rw-brand-subtitle">Research workspace</span></div>
			<button className="rw-search-button" type="button" onClick={() => setPaletteOpen(true)}><Search size={16} /><span>Search anything</span><kbd>⌘ K</kbd></button>
			<div className="rw-topbar-end"><span className="rw-local-indicator"><i /> Local workspace</span><IconButton label={`Theme: ${theme}. Change theme`} onClick={() => setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system")}>{theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}</IconButton></div>
		</header>
		<div className={`rw-body ${sidebar === "closed" ? "rw-sidebar-collapsed" : ""}`}>
			{mobileNav && <button type="button" className="rw-mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
			<aside className={`rw-sidebar ${mobileNav ? "rw-mobile-open" : ""}`} aria-label="Primary navigation">
				<div className="rw-sidebar-heading"><span>WORKSPACE</span><IconButton label={sidebar === "open" ? "Collapse sidebar" : "Expand sidebar"} onClick={() => setSidebar(sidebar === "open" ? "closed" : "open")}>{sidebar === "open" ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</IconButton></div>
				<nav><button type="button" className={page.kind === "home" ? "active" : ""} onClick={() => navigate("/")}><Home size={18} /><span>Home</span></button><button type="button" className={page.kind === "projects" || page.kind === "project" || page.kind === "question" ? "active" : ""} onClick={() => navigate("/projects")}><FolderOpen size={18} /><span>Projects</span></button><button type="button" className={page.kind === "notes" ? "active" : ""} onClick={() => navigate("/notes")}><StickyNote size={18} /><span>Notes</span></button><button type="button" className={page.kind === "settings" ? "active" : ""} onClick={() => navigate("/settings/ai-providers")}><Settings size={18} /><span>Settings</span></button></nav>
				<div className="rw-sidebar-section"><span>RECENT PROJECTS</span></div>
				<div className="rw-sidebar-projects">{projects.slice(0, 6).map((item) => <button type="button" key={item.id} className={project?.id === item.id ? "active" : ""} onClick={() => navigate(researchPath(item.id))} title={item.name}><span className="rw-project-initial">{item.name.charAt(0).toUpperCase()}</span><span>{item.name}</span></button>)}</div>
				<div className="rw-sidebar-footer"><span className="rw-sidebar-footer-dot" /> Axorbis local</div>
			</aside>
			<main className="rw-main" id="main-content">
				{error && <div className="rw-alert" role="alert"><span>{error}</span><IconButton label="Dismiss error" onClick={() => setError(null)}><X size={16} /></IconButton></div>}
				{!state ? <div className="rw-loading">Opening your workspace…</div> : page.kind === "home" ? <HomePage state={state} projects={projects} recent={recent} navigate={navigate} newProject={() => openDialog("project")} /> : page.kind === "projects" ? <ProjectsPage state={state} projects={projects} navigate={navigate} newProject={() => openDialog("project")} /> : page.kind === "notes" ? <NotesPage notes={notes} setNotes={updateNotes} /> : page.kind === "settings" ? <>{researchAccess && <ResearchAccess status={researchAccess} onSaveSearch={saveSearch} onConnectAlpha={connectAlpha} saving={savingResearchAccess} connectingAlpha={connectingAlpha} />}<AiProviders providers={aiProviderRecords} onSave={saveAiProvider} onTest={testAiProvider} onRemove={(provider) => removeAiProvider(provider.id)} savingProviderId={savingProviderId} testingProviderId={testingProviderId} /></> : !project ? <Empty title="Project not found" detail="Choose another project to continue." action={<button className="rw-button" onClick={() => navigate("/projects")}>View projects</button>} /> : page.kind === "project" ? <ProjectPage state={state} project={project} questions={questions} navigate={navigate} newQuestion={() => openDialog("question")} onState={setState} onError={setError} /> : !question ? <Empty title="Question not found" detail="Choose another question in this project." action={<button className="rw-button" onClick={() => navigate(researchPath(project.id))}>Open project</button>} /> : <QuestionPage state={state} project={project} question={question} questions={questions} claims={claims} artifacts={artifacts} plan={plan} session={session} busy={busy} view={view} setView={setView} mode={mode} setMode={setMode} draft={draft} setDraft={setDraft} composerInput={composerInput} send={() => void sendResearch()} stop={() => void stopResearch()} onComposerKey={onComposerKey} selection={selection} selectedClaim={selectedClaim} selectedArtifact={selectedArtifact} preview={preview} setSelection={setSelection} selectArtifact={selectArtifact} navigate={navigate} newQuestion={() => openDialog("question")} treeOpen={tree === "open"} toggleTree={() => setTree(tree === "open" ? "closed" : "open")} />}
			</main>
		</div>
		{update && update.version !== dismissedUpdate && <aside className="rw-update-announcement" role="status" aria-label="Axorbis update available"><div><span className="rw-kicker">NEW VERSION</span><IconButton label="Dismiss update announcement" onClick={() => setDismissedUpdate(update.version)}><X size={16} /></IconButton></div><strong>{update.title}</strong>{update.notes && <p>{update.notes}</p>}<a href={update.url} target="_blank" rel="noopener noreferrer">View release and download <ArrowRight size={15} /></a></aside>}
		{paletteOpen && <div className="rw-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}><div className="rw-palette" role="dialog" aria-modal="true" aria-label="Search and commands"><div className="rw-palette-input"><Search size={19} /><input ref={paletteInput} value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") paletteItems[0]?.action(); }} placeholder="Search projects, questions, commands…" /><kbd>ESC</kbd></div><div className="rw-palette-results">{paletteItems.length ? paletteItems.map((item, index) => <button type="button" key={`${item.label}:${item.detail}:${index}`} onClick={item.action}><span>{item.label}</span><small>{item.detail}</small></button>) : <p>No results</p>}</div><footer><Command size={13} /> Search to navigate · Enter opens the first result</footer></div></div>}
		{dialog && <div className="rw-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><form className="rw-dialog" role="dialog" aria-modal="true" aria-label={dialog === "project" ? "New project" : "New research question"} onSubmit={(event) => void createItem(event)}><div className="rw-dialog-header"><div><span className="rw-kicker">CREATE</span><h2>{dialog === "project" ? "New project" : "New research question"}</h2></div><IconButton label="Close" onClick={() => setDialog(null)}><X size={18} /></IconButton></div><label htmlFor="rw-new-title">{dialog === "project" ? "Project name" : "What do you want to understand?"}</label><input id="rw-new-title" autoFocus required maxLength={140} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder={dialog === "project" ? "e.g. Mechanistic interpretability" : "e.g. Are these results reproducible?"} /><p>{dialog === "project" ? "Keep your questions, sources, and outputs together." : "Give this investigation a focused starting point."}</p><div className="rw-dialog-actions"><button type="button" onClick={() => setDialog(null)}>Cancel</button><button className="rw-button" type="submit" disabled={creating || !newTitle.trim()}>{creating ? "Creating…" : "Create"}<ArrowRight size={16} /></button></div></form></div>}
	</div>;
}

import quotesCsvRaw from "../../../app/ui/quotes.csv?raw";

const QUOTES = quotesCsvRaw
	.trim()
	.split('\n')
	.slice(1) // Skip header
	.map(line => {
		const match = line.match(/^"(.*)","(.*)","(.*)"$/);
		if (match) return { en: match[1], vi: match[2], source: match[3] };
		return null;
	})
	.filter((q): q is NonNullable<typeof q> => Boolean(q));

function HomePage({ state, projects, recent, navigate, newProject }: { state: WorkbenchState; projects: WorkbenchProject[]; recent: { project: WorkbenchProject; run: WorkbenchRun }[]; navigate: (path: string) => void; newProject: () => void }) {
	const quote = useMemo(() => QUOTES[Math.floor(Math.random() * QUOTES.length)], []);
	const questionSlugs = new Set(recent.map(({ run }) => run.slug));
	const needsEvidence = state.claims.filter((claim) => claim.status === "unverified" && (questionSlugs.has(claim.runSlug ?? "") || questionSlugs.has(claim.sessionId ?? ""))).length;
	const sourceCount = new Set(projects.flatMap((project) => projectArtifacts(state, project).filter((item) => item.category === "paper").map((item) => item.path))).size;
	const modelSetupNeeded = !state.modelStatus?.currentValid && !state.aiProviders?.some((provider) => Boolean(provider.defaultModel && (provider.kind === "ollama" || provider.kind === "lm-studio" || provider.credentialRoles.inference?.configured)));
	return <div className="rw-page rw-home">
		<div className="rw-page-intro">
			<span className="rw-kicker">YOUR WORKSPACE</span>
			<div className="rw-page-title-row"><div><h1>Keep the question in focus.</h1></div><button className="rw-button" type="button" onClick={newProject}><Plus size={17} /> New project</button></div>
			{quote && <blockquote className="rw-home-quote">
				<p className="rw-quote-en">{quote.en}</p>
				<p className="rw-quote-vi">{quote.vi}</p>
				<footer>{quote.source}</footer>
			</blockquote>}
		</div>
		{modelSetupNeeded && <div className="rw-setup-note"><span className="rw-setup-symbol">!</span><span><strong>Model setup needed</strong> · Configure an AI provider to use research.</span><button className="rw-text-action" type="button" onClick={() => navigate("/settings/ai-providers")}>Open provider settings <ArrowRight size={15} /></button></div>}
		<div className="rw-summary-line"><div><strong>{projects.length}</strong><span className="rw-summary-label"><FolderOpen size={15} /> Projects</span></div><div><strong>{recent.length}</strong><span className="rw-summary-label"><BookOpen size={15} /> Questions</span></div><div><strong>{sourceCount}</strong><span className="rw-summary-label"><FileText size={15} /> Paper files</span></div><div><strong>{needsEvidence}</strong><span className="rw-summary-label"><Check size={15} /> Claims to verify</span></div></div>
		<div className="rw-home-columns"><section><div className="rw-section-head"><h2>Continue researching</h2><span>{recent.length} questions</span></div>{recent.length ? <div className="rw-row-list">{recent.slice(0, 7).map(({ project, run }) => <button type="button" className="rw-work-row" key={`${project.id}:${run.slug}`} onClick={() => navigate(researchPath(project.id, run.slug))}><span className="rw-row-mark"><BookOpen size={18} /></span><span className="rw-row-copy"><strong>{run.title}</strong><small>{project.name} · Updated {formattedDate(run.updatedAt)}</small></span><ChevronRight size={18} /></button>)}</div> : <Empty title="Start with a project" detail="Create a project, then add a question to begin your research." onClick={newProject} action={<span className="rw-text-action">Create project <ArrowRight size={16} /></span>} />}</section><aside><div className="rw-section-head"><h2>Recent projects</h2><button type="button" className="rw-text-action" onClick={() => navigate("/projects")}>View all <ArrowRight size={15} /></button></div><div className="rw-quick-projects">{projects.slice(0, 5).map((item) => <button type="button" key={item.id} onClick={() => navigate(researchPath(item.id))}><span className="rw-project-initial">{item.name.charAt(0).toUpperCase()}</span><span>{item.name}</span><ArrowRight size={15} /></button>)}{!projects.length && <p>Projects you create will appear here.</p>}</div></aside></div>
	</div>;
}

function NotesPage({ notes, setNotes }: { notes: WorkbenchNote[]; setNotes: (notes: WorkbenchNote[]) => void }) {
	const [selectedId, setSelectedId] = useState<string | null>(() => notes[0]?.id ?? null);
	useEffect(() => {
		if (!notes.length) setSelectedId(null);
		else if (!selectedId || !notes.some((note) => note.id === selectedId)) setSelectedId(notes[0].id);
	}, [notes, selectedId]);
	const selected = notes.find((note) => note.id === selectedId);
	function createNote() {
		const note: WorkbenchNote = { id: createLocalId("note"), title: "Untitled note", items: [{ id: createLocalId("item"), text: "", done: false }], updatedAt: Date.now() };
		setNotes([...notes, note]); setSelectedId(note.id);
	}
	function updateNote(id: string, update: Partial<WorkbenchNote>) {
		setNotes(notes.map((note) => note.id === id ? { ...note, ...update, updatedAt: Date.now() } : note));
	}
	function updateItem(itemId: string, update: Partial<NoteChecklistItem>) {
		if (!selected) return;
		updateNote(selected.id, { items: selected.items.map((item) => item.id === itemId ? { ...item, ...update } : item) });
	}
	function addItem() {
		if (!selected) return;
		updateNote(selected.id, { items: [...selected.items, { id: createLocalId("item"), text: "", done: false }] });
	}
	function removeItem(itemId: string) {
		if (!selected) return;
		updateNote(selected.id, { items: selected.items.filter((item) => item.id !== itemId) });
	}
	function removeSelected() {
		if (!selected) return;
		const remaining = notes.filter((note) => note.id !== selected.id);
		setNotes(remaining); setSelectedId(remaining[0]?.id ?? null);
	}
	return <div className="rw-page rw-notes-page"><div className="rw-page-intro"><span className="rw-kicker">WORKSPACE / NOTES</span><div className="rw-page-title-row"><div><h1>Notes</h1><p>Capture ideas and turn them into focused checklists.</p></div><button className="rw-button" type="button" onClick={createNote}><Plus size={17} /> New note</button></div></div>{notes.length && selected ? <div className="rw-notes-layout"><aside className="rw-notes-list"><div className="rw-notes-list-head"><strong>All notes</strong><span>{notes.length}</span></div><div className="rw-notes-list-items">{notes.map((note) => <button type="button" key={note.id} className={note.id === selected.id ? "active" : ""} onClick={() => setSelectedId(note.id)}><span className="rw-notes-list-title">{note.title || "Untitled note"}</span><small>{note.items.filter((item) => !item.done).length} open · {formattedDate(new Date(note.updatedAt).toISOString())}</small></button>)}</div><button className="rw-notes-add" type="button" onClick={createNote}><Plus size={15} /> Add note</button></aside><section className="rw-note-editor"><div className="rw-note-editor-head"><StickyNote size={19} /><button className="rw-notes-delete" type="button" onClick={removeSelected}>Delete note</button></div><input className="rw-note-title" value={selected.title} onChange={(event) => updateNote(selected.id, { title: event.target.value })} placeholder="Note title" aria-label="Note title" /><div className="rw-note-checklist">{selected.items.map((item) => <div className={`rw-note-item ${item.done ? "done" : ""}`} key={item.id}><input type="checkbox" checked={item.done} onChange={(event) => updateItem(item.id, { done: event.target.checked })} aria-label={`Mark ${item.text || "item"} complete`} /><input value={item.text} onChange={(event) => updateItem(item.id, { text: event.target.value })} placeholder="Add a checklist item…" aria-label="Checklist item" /><IconButton label="Remove checklist item" onClick={() => removeItem(item.id)}><X size={14} /></IconButton></div>)}</div><button className="rw-note-add-item" type="button" onClick={addItem}><Plus size={15} /> Add checklist item</button><div className="rw-note-editor-foot">{selected.items.filter((item) => item.done).length}/{selected.items.length} complete · Saved locally</div></section></div> : <div className="rw-notes-empty"><span className="rw-empty-mark"><StickyNote size={18} /></span><h2>No notes yet</h2><p>Create a note and break it into clear, actionable checklist items.</p><button className="rw-button" type="button" onClick={createNote}><Plus size={16} /> Create note</button></div>}</div>;
}

function ProjectsPage({ state, projects, navigate, newProject }: { state: WorkbenchState; projects: WorkbenchProject[]; navigate: (path: string) => void; newProject: () => void }) {
	return <div className="rw-page"><div className="rw-page-intro"><span className="rw-kicker">WORKSPACE / PROJECTS</span><div className="rw-page-title-row"><div><h1>Projects</h1><p>A place for every line of inquiry.</p></div><button className="rw-button" type="button" onClick={newProject}><Plus size={17} /> New project</button></div></div>{projects.length ? <div className="rw-project-table"><div className="rw-table-labels"><span>PROJECT</span><span>QUESTIONS</span><span>FILES</span><span>UPDATED</span></div>{projects.map((item) => <button type="button" className="rw-project-row" key={item.id} onClick={() => navigate(researchPath(item.id))}><span className="rw-project-name"><span className="rw-project-initial">{item.name.charAt(0).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.description || "Research project"}</small></span></span><span>{projectQuestions(state, item).length}</span><span>{item.artifactCount}</span><span>{formattedDate(item.updatedAt)}</span></button>)}</div> : <Empty title="No projects yet" detail="Start with one research topic. You can add questions as you go." action={<button className="rw-button" type="button" onClick={newProject}><Plus size={16} /> New project</button>} />}</div>;
}

function ProjectPage({ state, project, questions, navigate, newQuestion, onState, onError }: { state: WorkbenchState; project: WorkbenchProject; questions: WorkbenchRun[]; navigate: (path: string) => void; newQuestion: () => void; onState: (state: WorkbenchState) => void; onError: (message: string) => void }) {
	const files = projectArtifacts(state, project);
	const claimCount = state.claims.filter((claim) => questions.some((run) => claim.runSlug === run.slug || claim.sessionId === run.slug)).length;
	return <div className="rw-page">
		<div className="rw-breadcrumb"><button type="button" onClick={() => navigate("/projects")}>Projects</button><ChevronRight size={15} /><span>{project.name}</span></div>
		<div className="rw-page-intro"><span className="rw-kicker">PROJECT</span><div className="rw-page-title-row"><div><h1>{project.name}</h1><p>{project.description || "Questions, evidence, and outputs in one place."}</p></div><button className="rw-button" type="button" onClick={newQuestion}><Plus size={17} /> New question</button></div></div>
		<div className="rw-project-summary"><span><strong>{questions.length}</strong> Questions</span><span><strong>{files.filter((item) => item.category === "paper").length}</strong> Paper files</span><span><strong>{claimCount}</strong> Claims</span><span><strong>{files.length}</strong> Files</span></div>
		<ProjectFiles files={files} questions={questions} navigateQuestion={(run) => navigate(researchPath(project.id, run.slug))} newQuestion={newQuestion} onState={onState} onError={onError} />
	</div>;
}

type QuestionProps = {
	state: WorkbenchState; project: WorkbenchProject; question: WorkbenchRun; questions: WorkbenchRun[];
	claims: WorkbenchResearchClaim[]; artifacts: WorkbenchArtifact[]; plan?: WorkbenchGeneratedPlan;
	session: WorkbenchChatSession | null; busy: boolean; view: View; setView: (view: View) => void;
	mode: ResearchMode; setMode: (mode: ResearchMode) => void; draft: string; setDraft: (draft: string) => void;
	composerInput: React.RefObject<HTMLTextAreaElement | null>; send: () => void; stop: () => void;
	onComposerKey: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	selection: Selection; selectedClaim?: WorkbenchResearchClaim; selectedArtifact?: WorkbenchArtifact; preview: FilePreview | null;
	setSelection: (selection: Selection) => void; selectArtifact: (path: string) => void;
	navigate: (path: string) => void; newQuestion: () => void; treeOpen: boolean; toggleTree: () => void;
};

function QuestionPage(props: QuestionProps) {
	const { state, project, question, questions, claims, artifacts, plan, session, busy, view, setView, mode, setMode, draft, setDraft, composerInput, send, stop, onComposerKey, selection, selectedClaim, selectedArtifact, preview, setSelection, selectArtifact, navigate, newQuestion, treeOpen, toggleTree } = props;
	const sources = artifacts.filter((item) => item.category === "paper" || item.category === "data");
	const outputs = artifacts.filter((item) => item.category === "output" || item.category === "draft");
	const notes = artifacts.filter((item) => item.category === "note");
	return <div className="rw-question-page"><div className="rw-question-toolbar"><div className="rw-breadcrumb"><button type="button" onClick={() => navigate("/projects")}>Projects</button><ChevronRight size={14} /><button type="button" onClick={() => navigate(researchPath(project.id))}>{project.name}</button><ChevronRight size={14} /><span>Research</span></div><IconButton label={treeOpen ? "Hide question list" : "Show question list"} pressed={treeOpen} onClick={toggleTree}>{treeOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</IconButton></div><div className={`rw-workspace ${treeOpen ? "rw-with-tree" : ""} ${selection ? "rw-with-inspector" : ""}`}>
		{treeOpen && <aside className="rw-tree" aria-label="Research questions"><div className="rw-tree-head"><span>THIS PROJECT</span><IconButton label="New research question" onClick={newQuestion}><Plus size={16} /></IconButton></div><div className="rw-tree-project">{project.name}</div><div className="rw-tree-label">QUESTIONS <span>{questions.length}</span></div>{questions.map((item) => <button type="button" className={`rw-tree-question ${item.slug === question.slug ? "active" : ""}`} key={item.slug} onClick={() => navigate(researchPath(project.id, item.slug))}><span className="rw-tree-question-dot" /><span>{item.title}</span></button>)}</aside>}
		<div className="rw-workspace-center"><div className="rw-question-heading"><span className="rw-kicker">RESEARCH QUESTION</span><h1>{question.title}</h1><div className="rw-question-details"><span className="rw-red-dot" />{busy ? "Research running" : "Ready to research"}<span className="rw-detail-separator">/</span>{sources.length} sources<span className="rw-detail-separator">/</span>{claims.length} claims</div></div><div className="rw-tabbar" role="tablist" aria-label="Research views">{(["overview", "sources", "claims", "activity"] as const).map((tab) => <button type="button" role="tab" aria-selected={view === tab} className={view === tab ? "active" : ""} key={tab} onClick={() => setView(tab)}>{tab === "overview" ? "Overview" : tab === "sources" ? `Sources ${sources.length}` : tab === "claims" ? `Claims ${claims.length}` : "Activity"}</button>)}</div><div className="rw-workspace-content">
			{view === "overview" && <><div className="rw-content-section"><div className="rw-section-head"><h2>Research plan</h2><span>{plan?.status.replaceAll("_", " ") || "Not started"}</span></div>{plan?.steps.length ? <ol className="rw-plan-list">{plan.steps.map((step, index) => <li key={`${step.title}:${index}`}><span className={`rw-step-icon ${step.status === "complete" ? "done" : ""}`}>{step.status === "complete" ? <Check size={14} /> : String(index + 1).padStart(2, "0")}</span><span><strong>{step.title}</strong>{step.description && <small>{step.description}</small>}</span></li>)}</ol> : <div className="rw-soft-empty">No plan yet. Choose <strong>Deep research</strong> below to investigate this question.</div>}</div><div className="rw-content-section"><div className="rw-section-head"><h2>Findings</h2><button type="button" className="rw-text-action" onClick={() => setView("claims")}>View all <ArrowRight size={15} /></button></div>{claims.length ? <div className="rw-compact-rows">{claims.slice(0, 3).map((claim) => <button type="button" key={claim.id} onClick={() => setSelection({ kind: "claim", id: claim.id })}><span>{claim.claim}</span><small>{claim.status === "unverified" ? "Needs verification" : claim.status === "verified" ? "Verified" : "Failed check"}</small><ChevronRight size={16} /></button>)}</div> : <div className="rw-soft-empty">Findings will appear here as evidence is recorded.</div>}</div><div className="rw-content-section"><div className="rw-section-head"><h2>Research material</h2><button type="button" className="rw-text-action" onClick={() => setView("sources")}>Sources <ArrowRight size={15} /></button></div><div className="rw-material-summary"><span><strong>{sources.length}</strong> sources</span><span><strong>{notes.length}</strong> notes</span><span><strong>{outputs.length}</strong> outputs</span></div></div></>}
			{view === "sources" && <><div className="rw-section-head"><h2>Sources</h2><span>{sources.length} linked files</span></div>{sources.length ? <ArtifactList artifacts={sources} onSelect={selectArtifact} /> : <Empty title="No sources linked yet" detail="Research results and imported papers connected to this question will appear here." />}</>}
			{view === "claims" && <><div className="rw-section-head"><h2>Claims & evidence</h2><span>{claims.length} recorded claims</span></div>{claims.length ? <div className="rw-claim-list">{claims.map((claim, index) => <button type="button" key={claim.id} onClick={() => setSelection({ kind: "claim", id: claim.id })}><span className="rw-claim-index">{String(index + 1).padStart(2, "0")}</span><span><strong>{claim.claim}</strong><small>{claim.status === "unverified" ? "Needs verification" : claim.status === "verified" ? "Verified" : "Failed check"} · {claim.evidencePaths.length} evidence files</small></span><ChevronRight size={16} /></button>)}</div> : <Empty title="No claims yet" detail="Findings extracted from research outputs and verification checks will appear here." />}</>}
			{view === "activity" && <><div className="rw-section-head"><h2>Research activity</h2><span>{busy ? "Working now" : `${session?.messages.length ?? 0} messages`}</span></div>{session?.messages.filter((message) => message.role !== "system").length ? <div className="rw-activity-list">{session.messages.filter((message) => message.role !== "system").map((message) => <article className={`rw-message rw-message-${message.role}`} key={message.id}><div><span>{message.role === "user" ? "You" : "Axorbis"}</span><small>{formattedDate(message.createdAt)}</small></div><MarkdownContent content={readableResearchMessage(message.content)} />{message.role === "assistant" && message.status === "running" && <span className="rw-running">Research in progress…</span>}{message.role === "assistant" && message.toolEvents.length > 0 && <details><summary>{message.toolEvents.length} research steps</summary><ul>{message.toolEvents.map((item) => <li key={item.id}>{item.label} · {item.status}</li>)}</ul></details>}</article>)}</div> : <Empty title="No activity yet" detail="Ask a question or start deep research below. Progress and answers will appear here." />}</>}
		</div><form className="rw-composer" onSubmit={(event) => { event.preventDefault(); send(); }}><div className="rw-composer-main"><textarea ref={composerInput} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKey} rows={2} placeholder={mode === "ask" ? "Ask Axorbis about this research…" : `Press Enter to run ${MODE_LABELS[mode]} on "${question.title}"`} aria-label="Ask Axorbis about this research" /><button className="rw-send-button" type={busy ? "button" : "submit"} disabled={!busy && !draft.trim() && mode === "ask"} onClick={busy ? stop : undefined} aria-label={busy ? "Stop research" : "Send research request"}>{busy ? <Square size={16} fill="currentColor" /> : <ArrowUp size={19} />}</button></div><div className="rw-composer-foot"><label><span>MODE</span><select value={mode} onChange={(event) => setMode(event.target.value as ResearchMode)} disabled={busy}><optgroup label="Core"><option value="ask">Ask</option><option value="deep">Deep research</option></optgroup><optgroup label="Research Workflows"><option value="lit">Literature review</option><option value="summarize">Summarize</option><option value="compare">Compare</option><option value="audit">Audit</option><option value="recipe">Recipe</option><option value="replicate">Replicate</option><option value="autoresearch">Auto research</option><option value="watch">Watch</option></optgroup><optgroup label="Outputs"><option value="draft">Draft</option><option value="review">Review</option></optgroup></select></label><span>{mode === "ask" ? "Enter to send · Shift+Enter for a new line" : "Enter to run with question title · type to override"}</span></div></form></div>
		{selection && <aside className="rw-inspector" aria-label="Context inspector"><div className="rw-inspector-top"><span>DETAILS</span><IconButton label="Close details" onClick={() => setSelection(null)}><X size={17} /></IconButton></div>{selectedClaim ? <div className="rw-inspector-body"><span className="rw-kicker">CLAIM</span><h2>{selectedClaim.claim}</h2><span className="rw-status-label">{selectedClaim.status === "unverified" ? "Needs verification" : selectedClaim.status === "verified" ? "Verified" : "Failed check"}</span><dl><dt>Origin</dt><dd>{selectedClaim.sourceTitle}</dd><dt>Evidence files</dt><dd>{selectedClaim.evidencePaths.length}</dd><dt>Checks</dt><dd>{selectedClaim.checkIds.length}</dd></dl><h3>Linked evidence</h3>{selectedClaim.evidencePaths.length ? selectedClaim.evidencePaths.map((path) => <button type="button" className="rw-evidence-link" key={path} onClick={() => selectArtifact(path)}><FileText size={16} /><span>{path.split("/").at(-1)}</span><ArrowRight size={15} /></button>) : <p className="rw-inspector-muted">No evidence files linked yet.</p>}</div> : selectedArtifact ? <div className="rw-inspector-body"><span className="rw-kicker">{selectedArtifact.category.toUpperCase()}</span><h2>{selectedArtifact.displayName || selectedArtifact.title}</h2><p className="rw-inspector-path">{selectedArtifact.path}</p><dl><dt>Updated</dt><dd>{formattedDate(selectedArtifact.updatedAt)}</dd><dt>Size</dt><dd>{Math.max(1, Math.round(selectedArtifact.sizeBytes / 1024))} KB</dd></dl><h3>Preview</h3>{selectedArtifact.contentType === "application/pdf" ? <iframe className="rw-pdf-preview" title={`Preview ${selectedArtifact.displayName || selectedArtifact.title}`} src={`/api/file/download?path=${encodeURIComponent(selectedArtifact.path)}`} /> : preview?.content ? selectedArtifact.extension.toLowerCase() === ".md" ? <MarkdownContent content={preview.content} className="rw-inspector-markdown" /> : <pre className="rw-file-preview">{preview.content}</pre> : <p className="rw-inspector-muted">No text preview available.</p>}<a className="rw-download" href={`/api/file/download?path=${encodeURIComponent(selectedArtifact.path)}`}>Download file <ArrowRight size={15} /></a></div> : null}</aside>}
	</div></div>;
}

function ArtifactList({ artifacts, onSelect }: { artifacts: WorkbenchArtifact[]; onSelect: (path: string) => void }) {
	return <div className="rw-artifact-list">{artifacts.map((artifact) => <button type="button" key={artifact.path} onClick={() => onSelect(artifact.path)}><span className="rw-row-mark"><FileText size={18} /></span><span className="rw-row-copy"><strong>{artifact.displayName || artifact.title}</strong><small>{artifact.category} · Updated {formattedDate(artifact.updatedAt)}</small></span><ChevronRight size={18} /></button>)}</div>;
}
