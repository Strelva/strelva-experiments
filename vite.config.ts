import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import chatHandler from "./api/chat.ts";

export default defineConfig(({ mode }) => {
  const localEnvironment = loadEnv(mode, process.cwd(), "");
  process.env.NAVIGATOR_MODE ??= localEnvironment.NAVIGATOR_MODE;

  return {
    plugins: [react(), {
      name: "strelva-agent-api",
      configureServer(server) {
        server.middlewares.use("/api/chat", (request, response) => { void chatHandler(request, response); });
      },
    }],
  };
});
