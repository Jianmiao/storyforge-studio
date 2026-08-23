import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";
import "./preview/previewFonts.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root 不存在");
createRoot(root).render(<App />);
