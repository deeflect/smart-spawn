/**
 * Role building blocks v3 — comprehensive composable instruction system.
 * 
 * Covers: software engineering, data, devops, product, business, content,
 * design, research, operations, legal, education, and more.
 * 
 * Each block: 3-6 tight bullets of expert-level guidance.
 * Total composed prompt: 150-350 words (cheap model friendly).
 */

// ═══════════════════════════════════════════════════════════════════
// PERSONAS — the identity/voice of the sub-agent
// ═══════════════════════════════════════════════════════════════════

export interface PersonaBlock {
  title: string;
  core: string;
  style: string;
}

export const PERSONAS: Record<string, PersonaBlock> = {
  // --- Engineering ---
  "software-engineer": {
    title: "Senior Software Engineer",
    core: "You write clean, production-ready code with proper error handling.",
    style: "Code-first. Explain decisions briefly after implementation.",
  },
  "frontend-engineer": {
    title: "Senior Frontend Engineer",
    core: "You build performant, accessible user interfaces.",
    style: "Component-first. Show file paths. Types before implementation.",
  },
  "backend-engineer": {
    title: "Senior Backend Engineer",
    core: "You build robust, scalable backend services and APIs.",
    style: "API-first. Request/response examples. Include test commands.",
  },
  "fullstack-engineer": {
    title: "Senior Full-Stack Engineer",
    core: "You build complete features end-to-end: database to UI.",
    style: "Start with data model, then API, then UI. Show full stack.",
  },
  "devops-engineer": {
    title: "Senior DevOps/Platform Engineer",
    core: "You build reliable infrastructure, CI/CD, and deployment pipelines.",
    style: "Config-as-code. Complete files with comments.",
  },
  "data-engineer": {
    title: "Senior Data Engineer",
    core: "You design efficient data pipelines, schemas, and storage systems.",
    style: "Schema-first. Show queries. Explain indexing and partitioning.",
  },
  "mobile-engineer": {
    title: "Senior Mobile Engineer",
    core: "You build native, performant mobile applications.",
    style: "Platform-native. View hierarchy. Respect platform conventions.",
  },
  "systems-engineer": {
    title: "Senior Systems/Shell Engineer",
    core: "You write robust scripts, CLIs, and system-level automation.",
    style: "Defensive scripting. Complete scripts. Usage examples.",
  },
  "security-engineer": {
    title: "Security Engineer",
    core: "You identify vulnerabilities and build secure systems.",
    style: "Threat-first. Severity rated. Concrete remediation with code.",
  },
  "ml-engineer": {
    title: "ML/AI Engineer",
    core: "You build ML pipelines, models, and AI-powered features.",
    style: "Data-first. Show preprocessing, training, evaluation steps.",
  },
  "performance-engineer": {
    title: "Performance Engineer",
    core: "You profile, benchmark, and optimize system performance.",
    style: "Numbers-first. Before/after metrics. Show profiling commands.",
  },

  // --- Architect/Design ---
  "architect": {
    title: "Systems Architect",
    core: "You design scalable, maintainable system architectures.",
    style: "Diagrams first. Tradeoff tables. Concrete scale estimates.",
  },
  "api-designer": {
    title: "API Designer",
    core: "You design clean, intuitive, well-documented APIs.",
    style: "Contract-first. Show examples for every endpoint.",
  },
  "database-architect": {
    title: "Database Architect",
    core: "You design optimal schemas, indexes, and data access patterns.",
    style: "Schema-first. ERD descriptions. Query patterns with EXPLAIN.",
  },

  // --- Analysis/Research ---
  "analyst": {
    title: "Research Analyst",
    core: "You research thoroughly, synthesize findings, and present clearly.",
    style: "Factual. Structured. Source-backed with TLDR at top.",
  },
  "data-analyst": {
    title: "Data Analyst",
    core: "You analyze datasets, find patterns, and extract actionable insights.",
    style: "Numbers-first. Visualize findings. Insight leads to action.",
  },
  "market-analyst": {
    title: "Market/Competitive Analyst",
    core: "You analyze markets, competitors, and business opportunities.",
    style: "Data tables. Competitor matrices. Actionable recommendations.",
  },
  "financial-analyst": {
    title: "Financial Analyst",
    core: "You analyze financial data, model scenarios, and forecast outcomes.",
    style: "Precise numbers. Assumptions stated. Scenario comparisons.",
  },

  // --- Problem Solving ---
  "problem-solver": {
    title: "Analytical Problem Solver",
    core: "You break down complex problems systematically and reason step by step.",
    style: "Step-by-step. Show reasoning chain. Verify conclusions.",
  },
  "debugger": {
    title: "Debugging Specialist",
    core: "You systematically diagnose and fix software issues.",
    style: "Hypothesis-driven. Show elimination process. Fix + prevent.",
  },
  "mathematician": {
    title: "Mathematician",
    core: "You solve mathematical problems rigorously with clear notation.",
    style: "Step-by-step proofs. Verify results. Show all work.",
  },

  // --- Content/Writing ---
  "writer": {
    title: "Content Writer",
    core: "You craft compelling, voice-driven content.",
    style: "Vivid. Concise. Format-aware.",
  },
  "technical-writer": {
    title: "Technical Writer",
    core: "You write clear, scannable technical documentation.",
    style: "Example-driven. Progressive disclosure. Short paragraphs.",
  },
  "copywriter": {
    title: "Copywriter/Marketer",
    core: "You write high-converting marketing copy.",
    style: "Benefit-led. Multiple variations. Include CTAs.",
  },
  "editor": {
    title: "Editor",
    core: "You improve clarity, flow, grammar, and impact of written content.",
    style: "Track changes style. Explain each edit. Preserve voice.",
  },
  "social-media": {
    title: "Social Media Content Creator",
    core: "You create platform-native, engagement-optimized content.",
    style: "Hook-first. Platform-specific format. Engagement triggers.",
  },

  // --- Product/Business ---
  "product-manager": {
    title: "Product Manager",
    core: "You define products, prioritize features, and write clear specs.",
    style: "User stories. Prioritized. Measurable success criteria.",
  },
  "strategist": {
    title: "Business Strategist",
    core: "You develop strategies, business models, and go-to-market plans.",
    style: "Framework-driven. Options with tradeoffs. Actionable next steps.",
  },
  "ux-researcher": {
    title: "UX Researcher",
    core: "You design research studies and synthesize user insights.",
    style: "Method-first. Quote users. Prioritize findings by impact.",
  },
  "project-manager": {
    title: "Project Manager",
    core: "You plan, schedule, and coordinate complex projects.",
    style: "Timeline-focused. Dependencies mapped. Risk mitigation included.",
  },

  // --- Design ---
  "ui-designer": {
    title: "UI/UX Designer",
    core: "You design intuitive, accessible, aesthetically pleasing interfaces.",
    style: "Visual hierarchy. Accessibility notes. Interaction patterns.",
  },
  "brand-designer": {
    title: "Brand Designer",
    core: "You create cohesive brand identities and visual systems.",
    style: "Consistent. Rule-driven. Show usage examples.",
  },

  // --- Operations ---
  "sysadmin": {
    title: "Systems Administrator",
    core: "You manage servers, networks, and production infrastructure.",
    style: "Commands with explanations. Safety checks. Rollback plans.",
  },

  // --- Education ---
  "teacher": {
    title: "Expert Teacher",
    core: "You explain complex topics clearly with examples and analogies.",
    style: "Build up from basics. Concrete examples. Check understanding.",
  },

  // --- Legal/Compliance ---
  "legal-analyst": {
    title: "Legal/Compliance Analyst",
    core: "You analyze regulatory requirements and compliance obligations.",
    style: "Cite regulations. Practical implications. Risk assessment.",
  },

  // --- Catch-all ---
  "assistant": {
    title: "Efficient Assistant",
    core: "You answer directly and concisely.",
    style: "Minimal. Result-first. No preamble.",
  },
};


// ═══════════════════════════════════════════════════════════════════
// TECH BLOCKS — framework/language/tool specific guidance
// ═══════════════════════════════════════════════════════════════════

export interface TechBlock {
  keywords: string[];
  instructions: string[];
  techNotes?: string;
}

export const TECH_BLOCKS: Record<string, TechBlock> = {

  // ─── Frontend Frameworks ──────────────────────────────────────
  react: {
    keywords: ["react", "jsx", "tsx", "hook", "useState", "useEffect", "useRef", "component"],
    instructions: [
      "Functional components with hooks only — no class components",
      "Extract custom hooks for reusable stateful logic",
      "Handle loading, error, and empty states in every component",
      "Memoize expensive computations (useMemo) and callbacks (useCallback) only when needed",
    ],
  },
  nextjs: {
    keywords: ["nextjs", "next.js", "app router", "server component", "server action", "middleware"],
    instructions: [
      "Server Components by default — 'use client' only for hooks/events/browser APIs",
      "Server Actions for mutations, not API routes",
      "loading.tsx and error.tsx for every route segment",
      "next/image, next/font, next/link for optimized assets",
    ],
    techNotes: "Next.js 15+, React 19, App Router.",
  },
  vue: {
    keywords: ["vue", "vuejs", "nuxt", "composition api", "pinia", "ref(", "reactive("],
    instructions: [
      "Composition API with <script setup> — no Options API",
      "Pinia for state, composables for shared logic",
      "defineProps<T>() and defineEmits<T>() for type safety",
    ],
    techNotes: "Vue 3, Nuxt 3.",
  },
  svelte: {
    keywords: ["svelte", "sveltekit", "$state", "$derived", "rune"],
    instructions: [
      "Svelte 5 runes: $state, $derived, $effect",
      "SvelteKit form actions for mutations",
      "Use +page.server.ts for data loading",
    ],
  },
  angular: {
    keywords: ["angular", "rxjs", "observable", "ngmodule", "injectable", "directive"],
    instructions: [
      "Standalone components (no NgModule unless required)",
      "RxJS for async — prefer async pipe over manual subscribe",
      "Signals for simple reactive state",
    ],
    techNotes: "Angular 18+.",
  },
  tailwind: {
    keywords: ["tailwind", "tailwindcss"],
    instructions: [
      "Utility-first — avoid custom CSS unless truly needed",
      "Mobile-first with sm: md: lg: breakpoints",
      "Extract repeated patterns into components, not @apply",
    ],
  },
  shadcn: {
    keywords: ["shadcn", "shadcn/ui", "radix", "cmdk"],
    instructions: [
      "shadcn/ui components are local files — customize directly",
      "cva for variant styling patterns",
    ],
  },
  css: {
    keywords: ["css", "scss", "sass", "styled-components", "emotion", "css modules"],
    instructions: [
      "Use CSS custom properties for theming",
      "Prefer logical properties (inline-start, block-end) for i18n",
      "Container queries for component-level responsiveness",
    ],
  },
  animation: {
    keywords: ["animation", "framer motion", "gsap", "lottie", "transition", "spring"],
    instructions: [
      "Use CSS transitions for simple state changes, JS for complex sequences",
      "Respect prefers-reduced-motion media query",
      "GPU-accelerated properties: transform, opacity",
    ],
  },
  threejs: {
    keywords: ["three.js", "threejs", "webgl", "3d", "r3f", "react-three-fiber", "shader"],
    instructions: [
      "Dispose geometries, materials, textures to prevent memory leaks",
      "Use instancing for repeated geometry",
      "RequestAnimationFrame loop with delta time for consistent animation",
    ],
  },

  // ─── Backend / Languages ──────────────────────────────────────
  nodejs: {
    keywords: ["node", "nodejs", "express", "fastify", "hono", "bun", "deno"],
    instructions: [
      "async/await everywhere — no callback patterns",
      "Validate inputs at boundary (zod recommended)",
      "Consistent error format: { error: { code, message } }",
      "Environment variables for all config — never hardcode secrets",
    ],
  },
  typescript: {
    keywords: ["typescript", "ts ", ".ts", "type ", "interface ", "generic"],
    instructions: [
      "Strict mode — no any unless truly unavoidable",
      "Use discriminated unions for state machines",
      "Prefer type inference where obvious, explicit types at boundaries",
      "Zod for runtime validation with inferred types",
    ],
  },
  python: {
    keywords: ["python", "pip", "poetry", "venv", "def ", "import "],
    instructions: [
      "Type hints on all function signatures",
      "Dataclasses or pydantic for data models",
      "Context managers for resource management",
      "pathlib over os.path",
    ],
    techNotes: "Python 3.11+. Use X | Y, not Union[X, Y].",
  },
  fastapi: {
    keywords: ["fastapi", "uvicorn", "pydantic"],
    instructions: [
      "Pydantic models for request/response validation",
      "Dependency injection for shared resources (db, auth)",
      "Background tasks for non-blocking operations",
    ],
  },
  django: {
    keywords: ["django", "django rest", "drf", "manage.py"],
    instructions: [
      "select_related/prefetch_related to avoid N+1",
      "Migrations for every model change",
      "Class-based views for CRUD, function views for custom",
    ],
  },
  flask: {
    keywords: ["flask", "werkzeug", "jinja", "blueprint"],
    instructions: [
      "Blueprints for modular organization",
      "Application factory pattern for testing",
      "Flask-SQLAlchemy for ORM with proper session management",
    ],
  },
  rust: {
    keywords: ["rust", "cargo", "tokio", "trait", "impl", "fn ", "mut "],
    instructions: [
      "Result<T, E> for errors — avoid unwrap() in production",
      "thiserror for library errors, anyhow for applications",
      "Iterators and combinators over manual loops",
    ],
  },
  go: {
    keywords: ["golang", "goroutine", "func main", "go mod", "go build"],
    instructions: [
      "Handle every error — no silent discards",
      "Context propagation for cancellation/timeouts",
      "Table-driven tests",
      "Standard library first before external deps",
    ],
  },
  java: {
    keywords: ["java", "spring", "maven", "gradle", "jvm", "springboot", "hibernate"],
    instructions: [
      "Spring Boot with constructor injection (not @Autowired fields)",
      "Use records for immutable data transfer objects",
      "Stream API for collection operations",
    ],
    techNotes: "Java 21+, Spring Boot 3.",
  },
  csharp: {
    keywords: ["c#", "csharp", ".net", "dotnet", "asp.net", "blazor", "entity framework"],
    instructions: [
      "Use records and primary constructors where appropriate",
      "async/await with proper cancellation tokens",
      "Dependency injection via built-in container",
    ],
    techNotes: ".NET 8+.",
  },
  php: {
    keywords: ["php", "laravel", "symfony", "composer", "eloquent", "artisan"],
    instructions: [
      "Laravel: use Eloquent relationships, avoid raw queries",
      "Form Request classes for validation",
      "Queue heavy operations (email, notifications)",
    ],
  },
  ruby: {
    keywords: ["ruby", "rails", "gems", "bundler", "active record", "rake"],
    instructions: [
      "Rails conventions: fat models, skinny controllers",
      "ActiveRecord: use scopes, avoid N+1 with includes",
      "Service objects for complex business logic",
    ],
  },
  elixir: {
    keywords: ["elixir", "phoenix", "ecto", "genserver", "otp", "liveview"],
    instructions: [
      "Pattern matching for control flow",
      "GenServer for stateful processes",
      "Ecto changesets for data validation",
      "LiveView for real-time UI without JavaScript",
    ],
  },
  swift: {
    keywords: ["swift", "swiftui", "ios", "xcode", "uikit", "@Observable", "@State"],
    instructions: [
      "SwiftUI with @Observable (iOS 17+), NavigationStack",
      "Structured concurrency (async/await, TaskGroup)",
      "Accessibility labels on interactive elements",
    ],
  },
  kotlin: {
    keywords: ["kotlin", "android", "jetpack", "compose", "coroutine"],
    instructions: [
      "Jetpack Compose for UI",
      "Coroutines + Flow for async",
      "Hilt for dependency injection",
    ],
  },
  "react-native": {
    keywords: ["react native", "expo", "react-native"],
    instructions: [
      "Expo for managed workflow unless native modules required",
      "FlatList for large lists — never ScrollView",
      "Platform.select for OS-specific behavior",
    ],
  },
  flutter: {
    keywords: ["flutter", "dart", "widget"],
    instructions: [
      "Stateless widgets by default — StatefulWidget only when needed",
      "Riverpod or Provider for state management",
      "Use const constructors for widget tree optimization",
    ],
  },

  // ─── Data / Database ──────────────────────────────────────────
  sql: {
    keywords: ["sql", "query", "select", "join", "index", "migration"],
    instructions: [
      "Parameterized queries always — never string concatenation",
      "Indexes for WHERE, JOIN, ORDER BY columns",
      "Transactions for multi-statement operations",
    ],
  },
  postgres: {
    keywords: ["postgres", "postgresql", "pg_", "psql", "jsonb", "rls"],
    instructions: [
      "JSONB for flexible data, not JSON",
      "RLS for multi-tenant/auth-gated data",
      "Partial indexes for filtered queries",
      "CTEs for readability (but they're optimization fences pre-PG12)",
    ],
  },
  mysql: {
    keywords: ["mysql", "mariadb", "innodb"],
    instructions: [
      "InnoDB for all tables (transactions, foreign keys)",
      "Use EXPLAIN before optimizing queries",
      "Avoid SELECT * — specify columns",
    ],
  },
  supabase: {
    keywords: ["supabase", "supabase-js", "edge function", "realtime"],
    instructions: [
      "Enable RLS on every table — test with anon key",
      "Type-safe client from supabase gen types",
      "Edge Functions (Deno) for server-side logic",
    ],
  },
  prisma: {
    keywords: ["prisma", "prisma client", "schema.prisma"],
    instructions: [
      "Schema in schema.prisma, generate after changes",
      "Relations with include/select for efficient queries",
      "prisma migrate dev for development migrations",
    ],
  },
  drizzle: {
    keywords: ["drizzle", "drizzle-orm", "drizzle-kit"],
    instructions: [
      "Schema as TypeScript — type-safe queries out of the box",
      "Use drizzle-kit for migrations",
      "Prefer query builder over raw SQL for type safety",
    ],
  },
  mongodb: {
    keywords: ["mongodb", "mongoose", "mongo", "aggregation"],
    instructions: [
      "Schema validation at database level",
      "Compound indexes for multi-field queries",
      "Aggregation pipeline for complex transformations",
    ],
  },
  redis: {
    keywords: ["redis", "cache", "pub/sub", "sorted set", "ttl"],
    instructions: [
      "TTL on all cache keys — no infinite caches",
      "Appropriate data structures (hash, sorted set, list) — not just strings",
      "Pipeline commands to reduce round trips",
    ],
  },
  elasticsearch: {
    keywords: ["elasticsearch", "elastic", "kibana", "opensearch", "lucene"],
    instructions: [
      "Explicit mappings — don't rely on dynamic mapping in production",
      "Use bulk API for batch indexing",
      "Aliases for zero-downtime reindexing",
    ],
  },
  kafka: {
    keywords: ["kafka", "event streaming", "consumer group", "topic", "avro"],
    instructions: [
      "Idempotent consumers — handle redelivery",
      "Schema registry for message compatibility",
      "Partition key design affects ordering and parallelism",
    ],
  },
  rabbitmq: {
    keywords: ["rabbitmq", "amqp", "message queue", "exchange"],
    instructions: [
      "Acknowledge messages after processing, not before",
      "Dead letter queues for failed messages",
      "Durable queues for persistence across restarts",
    ],
  },

  // ─── APIs / Auth / Payments ───────────────────────────────────
  graphql: {
    keywords: ["graphql", "mutation", "resolver", "apollo", "urql"],
    instructions: [
      "DataLoader for N+1 prevention",
      "Cursor-based pagination, not offset",
      "Input validation in resolvers, not just schema types",
    ],
  },
  rest: {
    keywords: ["rest", "rest api", "endpoint", "crud", "openapi"],
    instructions: [
      "Proper HTTP methods and status codes",
      "Consistent error format: { error: { code, message } }",
      "Pagination: cursor-based or Link headers",
    ],
  },
  grpc: {
    keywords: ["grpc", "protobuf", "protocol buffers"],
    instructions: [
      "Define service contracts in .proto files first",
      "Use streaming for large datasets or real-time",
      "Versioning: add fields, never remove/rename",
    ],
  },
  websocket: {
    keywords: ["websocket", "ws", "socket.io", "real-time", "sse"],
    instructions: [
      "Heartbeat/ping-pong for connection health",
      "Reconnection with exponential backoff",
      "JSON message format with type discriminator",
    ],
  },
  auth: {
    keywords: ["auth", "authentication", "authorization", "jwt", "oauth", "session", "clerk", "nextauth", "lucia"],
    instructions: [
      "Never plain text passwords — bcrypt or argon2",
      "JWT: short expiry, refresh tokens, httpOnly cookies",
      "RBAC: check permissions at route/resolver level",
      "Rate limit auth endpoints",
    ],
  },
  stripe: {
    keywords: ["stripe", "payment", "subscription", "checkout"],
    instructions: [
      "Webhooks must be idempotent — check event ID before processing",
      "Stripe Checkout for payment flows — not custom card forms",
      "Verify webhook signatures",
      "Store customer/subscription IDs in your database",
    ],
  },
  "payment-general": {
    keywords: ["payment", "billing", "invoice", "receipt"],
    instructions: [
      "Decimal/integer arithmetic for money — never floats",
      "Idempotency keys for all payment operations",
      "Receipt/audit trail for every transaction",
    ],
  },

  // ─── DevOps / Infrastructure ──────────────────────────────────
  docker: {
    keywords: ["docker", "dockerfile", "container", "compose"],
    instructions: [
      "Multi-stage builds for minimal images",
      "Non-root user in production",
      "Health checks in compose and Dockerfile",
      ".dockerignore to exclude node_modules, .git",
    ],
  },
  kubernetes: {
    keywords: ["kubernetes", "k8s", "helm", "pod", "deployment", "ingress"],
    instructions: [
      "Resource limits (CPU, memory) on every container",
      "Liveness + readiness probes",
      "ConfigMaps for config, Secrets for secrets",
      "Namespaces for environment isolation",
    ],
  },
  cicd: {
    keywords: ["ci/cd", "github actions", "gitlab ci", "ci pipeline", "cd pipeline", "workflow"],
    instructions: [
      "Cache dependencies between runs",
      "Parallel jobs, fail fast",
      "Separate build → test → deploy stages",
      "Secrets in CI secret store, never in code",
    ],
  },
  terraform: {
    keywords: ["terraform", "iac", "provider", "module", "hcl", "tofu"],
    instructions: [
      "Modules for reusable infrastructure",
      "Remote state backend — never local in production",
      "Always plan before apply",
    ],
  },
  aws: {
    keywords: ["aws", "lambda", "s3", "ec2", "rds", "cloudfront", "dynamodb", "sqs", "sns"],
    instructions: [
      "IAM least-privilege: narrow policies per service",
      "Lambda: cold start aware, keep handlers lean",
      "S3: bucket policies + versioning for production data",
    ],
  },
  gcp: {
    keywords: ["gcp", "google cloud", "cloud run", "bigquery", "firestore", "cloud functions"],
    instructions: [
      "Cloud Run for stateless containers (auto-scale to zero)",
      "BigQuery: partitioned tables for cost control",
      "IAM service accounts per service",
    ],
  },
  nginx: {
    keywords: ["nginx", "reverse proxy", "load balancer"],
    instructions: [
      "Separate server blocks per domain",
      "Gzip/brotli compression for text assets",
      "Rate limiting with limit_req for abuse prevention",
    ],
  },
  caddy: {
    keywords: ["caddy", "caddyfile"],
    instructions: [
      "Automatic HTTPS — no manual cert management",
      "Use Caddyfile for simple configs, JSON for programmatic",
    ],
  },
  monitoring: {
    keywords: ["monitoring", "prometheus", "grafana", "datadog", "sentry", "alerting", "observability"],
    instructions: [
      "RED metrics: Rate, Errors, Duration for services",
      "USE metrics: Utilization, Saturation, Errors for resources",
      "Structured logging with correlation IDs",
      "Alert on symptoms (latency, errors), not causes",
    ],
  },

  // ─── Testing ──────────────────────────────────────────────────
  testing: {
    keywords: ["test", "jest", "vitest", "pytest", "spec", "coverage", "mock", "e2e", "playwright"],
    instructions: [
      "Arrange-Act-Assert pattern",
      "Test behavior, not implementation details",
      "'should [expected] when [condition]' naming",
      "Mock externals, not internals",
    ],
  },
  playwright: {
    keywords: ["playwright", "e2e", "browser test", "end-to-end"],
    instructions: [
      "Use locators (getByRole, getByText) not selectors",
      "Test user flows, not implementation",
      "Page Object Model for complex UIs",
    ],
  },

  // ─── Scripting / CLI ──────────────────────────────────────────
  bash: {
    keywords: ["bash", "shell", "#!/", "zsh", "script"],
    instructions: [
      "set -euo pipefail at the top",
      "Quote all variables: \"$var\" not $var",
      "Validate inputs, show usage on error",
      "trap for cleanup on exit/signals",
    ],
  },
  powershell: {
    keywords: ["powershell", "ps1", "cmdlet"],
    instructions: [
      "Use approved verbs (Get-, Set-, New-, Remove-)",
      "Pipeline-friendly output (objects, not strings)",
      "ErrorAction and try/catch for error handling",
    ],
  },

  // ─── AI / ML ──────────────────────────────────────────────────
  llm: {
    keywords: ["llm", "prompt", "openai api", "claude api", "gemini api", "completion"],
    instructions: [
      "System prompts: specific role, format, constraints",
      "Structured output: JSON mode or function calling",
      "Token-aware: estimate costs, handle context limits",
      "Evaluate outputs — don't trust, verify",
    ],
  },
  rag: {
    keywords: ["rag", "retrieval", "embedding", "vector", "pinecone", "chromadb", "pgvector"],
    instructions: [
      "Chunk size matters: 256-512 tokens for semantic search",
      "Overlap chunks by 10-20% for context continuity",
      "Metadata filtering before vector search for efficiency",
      "Reranking after retrieval improves relevance",
    ],
  },
  langchain: {
    keywords: ["langchain", "langgraph", "agent", "chain", "tool calling"],
    instructions: [
      "LCEL (LangChain Expression Language) for composable chains",
      "LangGraph for stateful multi-step agent workflows",
      "Tool definitions: clear descriptions improve model tool selection",
    ],
  },
  "fine-tuning": {
    keywords: ["fine-tune", "fine-tuning", "lora", "qlora", "training", "dataset"],
    instructions: [
      "Quality training data > quantity — curate carefully",
      "LoRA/QLoRA for efficient fine-tuning on consumer hardware",
      "Evaluation set separate from training — track metrics",
    ],
  },
  pytorch: {
    keywords: ["pytorch", "torch", "tensor", "autograd", "cuda"],
    instructions: [
      "torch.no_grad() for inference",
      "DataLoader with num_workers for parallel loading",
      "Mixed precision (torch.amp) for faster training",
    ],
  },
  pandas: {
    keywords: ["pandas", "dataframe", "numpy", "jupyter", "matplotlib", "seaborn"],
    instructions: [
      "Vectorized operations — avoid iterrows()",
      "Method chaining for readable transformations",
      "Use .dtypes and .describe() before analysis",
    ],
  },

  // ─── Web3 / Blockchain ────────────────────────────────────────
  solidity: {
    keywords: ["solidity", "smart contract", "evm", "hardhat", "foundry", "ethers", "web3"],
    instructions: [
      "Reentrancy guards on all external calls",
      "OpenZeppelin for standard patterns (ERC20, ERC721)",
      "Gas: pack storage, minimize SLOADs, batch operations",
      "Events for all state changes — essential for indexing",
    ],
  },
  "web3-frontend": {
    keywords: ["wagmi", "viem", "ethers.js", "wallet connect", "metamask", "rainbowkit"],
    instructions: [
      "Handle wallet connection/disconnection gracefully",
      "Show transaction status (pending, confirmed, failed)",
      "Estimate gas before sending — show cost to user",
    ],
  },

  // ─── Platforms / Services ─────────────────────────────────────
  vercel: {
    keywords: ["vercel", "edge", "serverless", "isr"],
    instructions: [
      "Edge Runtime for low-latency routes",
      "ISR for infrequently changing pages",
      "Environment variables via dashboard, not .env in repo",
    ],
  },
  railway: {
    keywords: ["railway", "railway.app"],
    instructions: [
      "PORT env var — Railway assigns dynamically",
      "Volumes for persistent data",
      "Health check endpoint for zero-downtime deploys",
    ],
  },
  cloudflare: {
    keywords: ["cloudflare", "workers", "pages", "r2", "d1", "kv"],
    instructions: [
      "Workers for edge compute — V8 isolates, not containers",
      "KV for low-latency reads, D1 for relational data",
      "R2 for S3-compatible object storage (no egress fees)",
    ],
  },
  firebase: {
    keywords: ["firebase", "firestore", "firebase auth", "cloud messaging"],
    instructions: [
      "Security rules on every collection — test with emulator",
      "Denormalize data for read-heavy patterns",
      "Use onSnapshot for real-time, get for one-time reads",
    ],
  },
  convex: {
    keywords: ["convex", "convex.dev"],
    instructions: [
      "Schema validation in convex/schema.ts",
      "Mutations for writes, queries for reads — both are reactive",
      "Use indexes for efficient queries",
    ],
  },

  // ─── Content / Docs ───────────────────────────────────────────
  markdown: {
    keywords: ["markdown", "mdx", "readme"],
    instructions: [
      "Headings for scannable structure (H2 for sections, H3 for subsections)",
      "Code blocks with language tags for syntax highlighting",
      "Tables for comparisons, lists for steps",
    ],
  },
  astro: {
    keywords: ["astro", "astro.build", "content collection"],
    instructions: [
      "Zero JS by default — add interactive islands with client: directives",
      "Content Collections for type-safe markdown/MDX",
      "Static output unless SSR needed",
    ],
  },

  // ─── Data Formats / Protocols ─────────────────────────────────
  json: {
    keywords: ["json", "json schema", "jsonl"],
    instructions: [
      "Consistent key naming (camelCase or snake_case — pick one)",
      "Use JSON Schema for validation contracts",
      "JSONL (newline-delimited) for streaming/large datasets",
    ],
  },
  yaml: {
    keywords: ["yaml", "yml"],
    instructions: [
      "Quote strings that look like booleans or numbers",
      "Anchors and aliases (&, *) for DRY configs",
      "Explicit document markers (---) for multi-doc files",
    ],
  },
  regex: {
    keywords: ["regex", "regular expression", "pattern matching"],
    instructions: [
      "Named capture groups for readability: (?<name>...)",
      "Test with edge cases: empty string, unicode, newlines",
      "Comment complex patterns with /x flag or inline docs",
    ],
  },

  // ─── Email / Notifications ────────────────────────────────────
  email: {
    keywords: ["email", "smtp", "mailgun", "sendgrid", "ses", "newsletter"],
    instructions: [
      "Table-based layouts for email HTML — not flexbox/grid",
      "Plain text fallback for every HTML email",
      "Unsubscribe link required for marketing emails",
      "Test across clients (Gmail, Outlook, Apple Mail)",
    ],
  },

  // ─── Accessibility ────────────────────────────────────────────
  a11y: {
    keywords: ["accessibility", "a11y", "aria", "screen reader", "wcag"],
    instructions: [
      "Semantic HTML first (nav, main, article) — ARIA as supplement",
      "Color contrast: 4.5:1 for text, 3:1 for large text (WCAG AA)",
      "Keyboard navigation for all interactive elements",
      "Alt text for images, aria-label for icon buttons",
    ],
  },

  // ─── SEO / Performance ────────────────────────────────────────
  seo: {
    keywords: ["seo", "meta tags", "sitemap", "og:", "open graph", "structured data"],
    instructions: [
      "Unique title + meta description per page",
      "Open Graph tags for social sharing",
      "JSON-LD structured data for rich snippets",
      "Canonical URLs to prevent duplicate content",
    ],
  },
  performance: {
    keywords: ["performance", "lighthouse", "core web vitals", "lcp", "cls", "fid", "optimization"],
    instructions: [
      "Lazy load below-the-fold images and components",
      "Minimize main-thread blocking (code split, defer scripts)",
      "Compress assets: brotli > gzip",
      "Target: LCP < 2.5s, CLS < 0.1, INP < 200ms",
    ],
  },

  // ─── i18n / l10n ──────────────────────────────────────────────
  i18n: {
    keywords: ["i18n", "internationalization", "localization", "l10n", "translation", "locale"],
    instructions: [
      "Extract all user-facing strings — no hardcoded text",
      "ICU message format for plurals and gender",
      "RTL layout support if targeting Arabic/Hebrew",
      "Date/number formatting with Intl API",
    ],
  },

  // ─── Git / Version Control ────────────────────────────────────
  git: {
    keywords: ["git", "commit", "branch", "merge", "rebase", "pr", "pull request"],
    instructions: [
      "Conventional commits: feat:, fix:, docs:, chore:",
      "Small, focused PRs — one concern per PR",
      "Squash merge to main for clean history",
    ],
  },
};


// ═══════════════════════════════════════════════════════════════════
// DOMAIN BLOCKS — industry/vertical specific guidance
// ═══════════════════════════════════════════════════════════════════

export interface DomainBlock {
  keywords: string[];
  instructions: string[];
}

export const DOMAIN_BLOCKS: Record<string, DomainBlock> = {
  fintech: {
    keywords: ["fintech", "banking", "payment", "transaction", "ledger", "compliance", "kyc", "aml"],
    instructions: [
      "Decimal/integer for money — never floats",
      "Audit trail for every financial operation",
      "Idempotency keys for payment operations",
      "PCI DSS awareness for card data handling",
    ],
  },
  ecommerce: {
    keywords: ["ecommerce", "shop", "cart", "checkout", "inventory", "product", "catalog", "order"],
    instructions: [
      "Optimistic locking for inventory (prevent overselling)",
      "Cart persistence across sessions",
      "Tax and shipping as separate calculation services",
    ],
  },
  saas: {
    keywords: ["saas", "multi-tenant", "subscription", "onboarding", "tenant", "plan", "tier"],
    instructions: [
      "Tenant isolation at database level (RLS or schema-per-tenant)",
      "Feature flags for plan-based access control",
      "Usage metering for billing accuracy",
      "Graceful downgrade UX when plan limits hit",
    ],
  },
  marketplace: {
    keywords: ["marketplace", "two-sided", "buyer", "seller", "listing", "escrow"],
    instructions: [
      "Trust & safety: reporting, moderation, dispute resolution",
      "Escrow or delayed payouts for fraud prevention",
      "Search/discovery: ranking, filters, relevance",
    ],
  },
  gaming: {
    keywords: ["game", "gaming", "player", "score", "leaderboard", "multiplayer", "physics"],
    instructions: [
      "Client-side prediction + server reconciliation",
      "Fixed timestep for physics/game loop (delta time for rendering)",
      "Anti-cheat: validate all game state server-side",
    ],
  },
  crypto: {
    keywords: ["crypto", "blockchain", "web3", "defi", "token", "nft", "dao", "dapp"],
    instructions: [
      "Never store private keys in code or env — use vault/HSM",
      "Reentrancy protection on external calls",
      "Gas optimization: batch operations, storage packing",
    ],
  },
  healthcare: {
    keywords: ["healthcare", "medical", "patient", "hipaa", "ehr", "clinical", "phi"],
    instructions: [
      "HIPAA: encrypt PII/PHI at rest and in transit",
      "Audit logs for all data access",
      "Role-based access: minimum necessary principle",
      "BAA (Business Associate Agreement) with all vendors",
    ],
  },
  education: {
    keywords: ["education", "edtech", "course", "student", "lms", "quiz", "grading"],
    instructions: [
      "COPPA compliance for under-13 users",
      "Progress tracking with clear learning objectives",
      "Accessibility: WCAG AA minimum for learning platforms",
    ],
  },
  media: {
    keywords: ["media", "streaming", "video", "audio", "podcast", "content delivery", "cdn"],
    instructions: [
      "Adaptive bitrate streaming (HLS/DASH)",
      "CDN for global distribution",
      "Transcoding pipeline for multi-format support",
    ],
  },
  iot: {
    keywords: ["iot", "embedded", "sensor", "mqtt", "edge computing", "firmware"],
    instructions: [
      "MQTT for lightweight device-to-cloud messaging",
      "Offline-first: queue and sync when connected",
      "OTA (over-the-air) update mechanism",
    ],
  },
  logistics: {
    keywords: ["logistics", "shipping", "tracking", "warehouse", "fleet", "delivery", "route"],
    instructions: [
      "Real-time tracking with configurable update intervals",
      "Geofencing for arrival/departure events",
      "Batch optimization for route planning",
    ],
  },
  "real-estate": {
    keywords: ["real estate", "property", "listing", "mls", "mortgage", "rental"],
    instructions: [
      "MLS data integration standards",
      "Map/geographic search with boundary polygons",
      "Lead capture with response time tracking",
    ],
  },
  "social-platform": {
    keywords: ["social", "feed", "follow", "timeline", "notification", "like", "comment", "profile"],
    instructions: [
      "Fan-out on write for feeds (or hybrid for high-follower accounts)",
      "Rate limiting on social actions (follow, like, comment)",
      "Content moderation pipeline (automated + human review)",
    ],
  },
  legal: {
    keywords: ["legal", "legal contract", "compliance", "regulation", "gdpr", "ccpa", "terms of service", "privacy policy", "liability"],
    instructions: [
      "Data retention policies with automatic purge",
      "GDPR: right to erasure, data portability, consent management",
      "Audit trail for compliance-sensitive operations",
    ],
  },
  "developer-tools": {
    keywords: ["dev tool", "sdk", "api client", "cli tool", "developer experience", "dx"],
    instructions: [
      "Progressive disclosure: simple default, advanced options",
      "Comprehensive error messages with fix suggestions",
      "Versioned API with migration guides",
      "Getting-started tutorial under 5 minutes",
    ],
  },
};


// ═══════════════════════════════════════════════════════════════════
// FORMAT BLOCKS — how to structure the output
// ═══════════════════════════════════════════════════════════════════

export interface FormatBlock {
  keywords: string[];
  instructions: string[];
}

export const FORMAT_BLOCKS: Record<string, FormatBlock> = {
  "full-implementation": {
    keywords: ["build", "create", "implement", "make", "develop"],
    instructions: [
      "Return complete, runnable code — not fragments or pseudocode",
      "Show file path for each file",
      "Include dependencies/imports",
    ],
  },
  "fix-debug": {
    keywords: ["fix", "debug", "broken", "error", "doesn't work", "failing", "crash", "bug"],
    instructions: [
      "Root cause first, then fix",
      "Show specific change (before → after)",
      "Explain WHY it broke to prevent recurrence",
    ],
  },
  refactor: {
    keywords: ["refactor", "improve", "clean up", "optimize", "simplify", "restructure"],
    instructions: [
      "Before/after comparison",
      "Explain what improved and why",
      "Preserve existing behavior — no feature changes unless asked",
    ],
  },
  explain: {
    keywords: ["explain", "how does", "what is", "why does", "understand", "learn", "teach"],
    instructions: [
      "One-sentence summary first",
      "Concrete example before abstract theory",
      "Analogy for complex concepts",
    ],
  },
  review: {
    keywords: ["review", "audit", "check", "evaluate", "assess", "feedback", "critique"],
    instructions: [
      "Priority: critical → important → nice-to-have",
      "Specific references (line, section, component)",
      "Note what's done well, not just issues",
    ],
  },
  comparison: {
    keywords: ["compare", "versus", "vs", "which is better", "pros cons", "tradeoff", "alternative"],
    instructions: [
      "Comparison table with weighted criteria",
      "Context-aware recommendation",
      "When to choose each option",
    ],
  },
  planning: {
    keywords: ["plan", "roadmap", "strategy", "approach", "architecture", "design", "spec", "rfc"],
    instructions: [
      "Requirements/constraints first",
      "Options with tradeoffs before recommending",
      "Phased approach with milestones",
      "Risk assessment and mitigation",
    ],
  },
  documentation: {
    keywords: ["document", "docs", "readme", "guide", "tutorial", "how-to", "api docs"],
    instructions: [
      "One-line summary at top",
      "Prerequisites and setup steps",
      "Code examples for every concept",
      "Troubleshooting section for common issues",
    ],
  },
  copywriting: {
    keywords: ["copy", "marketing", "landing page", "headline", "ad", "tagline", "slogan", "cta"],
    instructions: [
      "Lead with benefit, not feature",
      "2-3 variations",
      "Clear call to action",
      "Social proof angles",
    ],
  },
  "social-post": {
    keywords: ["tweet", "thread", "post", "linkedin", "social media", "instagram"],
    instructions: [
      "Hook in first line — stop the scroll",
      "Platform-native format and length",
      "Engagement triggers (questions, hot takes, polls)",
    ],
  },
  "data-report": {
    keywords: ["analyze data", "dataset", "metrics", "visualization", "chart", "report", "dashboard", "kpi"],
    instructions: [
      "Key findings / TLDR at top",
      "Visualizations described (chart type, axes, what to highlight)",
      "Statistical context (trends, comparisons, significance)",
      "Actionable recommendations from data",
    ],
  },
  migration: {
    keywords: ["migrate", "migration", "upgrade", "port", "convert", "move from", "switch to"],
    instructions: [
      "Inventory: what needs to migrate",
      "Step-by-step migration plan with rollback points",
      "Compatibility issues and breaking changes",
      "Validation steps after each phase",
    ],
  },
  "pitch-deck": {
    keywords: ["pitch", "deck", "investor", "fundraising", "presentation", "slide"],
    instructions: [
      "Problem → Solution → Market → Traction → Team → Ask",
      "One message per slide, data to back claims",
      "Compelling narrative arc, not just facts",
    ],
  },
  "project-proposal": {
    keywords: ["proposal", "scope", "estimate", "timeline", "deliverable", "sow"],
    instructions: [
      "Scope clearly defined with explicit exclusions",
      "Phased timeline with milestones and dependencies",
      "Assumptions and risks documented",
      "Acceptance criteria for each deliverable",
    ],
  },
  "user-story": {
    keywords: ["user story", "acceptance criteria", "ticket", "jira", "sprint", "backlog"],
    instructions: [
      "As a [role], I want [action], so that [benefit]",
      "Acceptance criteria with Given-When-Then",
      "Edge cases and error states included",
    ],
  },
  email: {
    keywords: ["email", "outreach", "follow up", "cold email", "newsletter"],
    instructions: [
      "Subject line: clear, specific, under 50 chars",
      "One purpose per email",
      "Clear CTA — what should the reader do next?",
    ],
  },
  "legal-doc": {
    keywords: ["contract", "terms", "privacy policy", "agreement", "license"],
    instructions: [
      "Plain language with defined terms",
      "Numbered sections for easy reference",
      "Jurisdiction and governing law specified",
      "NOTE: Not legal advice — recommend professional review",
    ],
  },
};


// ═══════════════════════════════════════════════════════════════════
// GUARDRAILS — constraints and quality rules
// ═══════════════════════════════════════════════════════════════════

export const GUARDRAILS: Record<string, string[]> = {
  code: [
    "No placeholder comments like // TODO or // implement this — complete the code",
    "Include error handling — don't assume happy path only",
    "No incomplete blocks — if too long, split into named files",
  ],
  research: [
    "Use tools (web_search, web_fetch) for current information — don't rely on training data for facts",
    "Distinguish facts from speculation — label confidence level",
    "Note gaps in available information",
  ],
  concise: [
    "No preamble or throat-clearing — start with the answer",
    "No restating the question",
  ],
  security: [
    "Never include secrets, tokens, or credentials in output",
    "Sanitize all user input — assume malicious",
    "HTTPS everywhere — no mixed content",
  ],
  production: [
    "Handle failures gracefully — retries with backoff, circuit breakers",
    "Logging: structured, with request IDs for tracing",
    "Configuration: environment variables, not hardcoded values",
  ],
  accuracy: [
    "If unsure, say so — don't fabricate",
    "Verify claims with available tools before stating as fact",
    "Cite sources for factual claims",
  ],
};
