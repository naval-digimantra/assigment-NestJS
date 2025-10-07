# NestJS Workflow Engine

An in-memory workflow engine for NestJS. Handles task dependencies, retries, timeouts, and events.


## Getting Started

Install dependencies:

```bash
npm install
```

Run the example server:

```bash
npm run start:dev
```

Try the example endpoints:

```bash
curl http://localhost:3000/examples
curl -X POST http://localhost:3000/examples/data-processing
curl -X POST http://localhost:3000/examples/parallel-processing
curl -X POST http://localhost:3000/examples/error-handling
```

Or run from the command line:

```bash
npx ts-node src/examples/cli-demo.ts
npx ts-node src/examples/cli-demo.ts parallel-processing
```

