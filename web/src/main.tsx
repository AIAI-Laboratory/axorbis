import React from "react";
import { createRoot } from "react-dom/client";
import { ReviewApp } from "./review-app";
import "./styles/research-app.css";
import "./styles/research-system.css";
import "./review-integration.css";
import "./styles/review-typography.css";
import "./styles/review-monitor.css";
import "./styles/usage-section.css";
import "./styles/home-surface.css";
import "./styles/settings-surface.css";
import "./styles/reviews-surface.css";
import "./styles/open-surfaces.css";
import "./styles/motion.css";
import "./styles/reference-graph.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><ReviewApp /></React.StrictMode>);
