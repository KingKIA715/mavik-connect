export * from "./generated/api";
export * from "./generated/types";

// Orval's structural dedup extracts a standalone TS type into generated/types
// for any two operations sharing an identical params/query shape (currently
// listMessages and listDmMessages both use { limit?, offset? }). That collides
// with the same-named zod schema const already exported from generated/api.
// Nothing outside generated code imports these two names directly; the explicit
// re-export below resolves the ambiguity by taking precedence over the
// conflicting `export *` star-exports. If a future codegen run introduces a
// new collision, tsc will fail with the same TS2308 error — just add another
// explicit line here naming the conflicting export.
export { ListMessagesParams } from "./generated/api";
export { ListDmMessagesParams } from "./generated/api";
export * from "./manual-key-backup";
export * from './generated/api';
export * from './generated/types';
