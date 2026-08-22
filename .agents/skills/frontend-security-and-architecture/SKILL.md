---
name: frontend-security-and-architecture
description:
  Frontend and mobile engineering best practices, security standards (XSS, CSRF,
  OWASP, AI security), component communication patterns (colocation, nuqs URL state,
  composition, TanStack Query queryOptions), and hydration/rendering strategies.
  Use when designing state management, auditing frontend/mobile security, structuring
  React/Next.js/React Native architectures, or integrating data layers.
license: MIT
metadata:
  author: ai-dev-workflow
  version: '1.0.0'
---

# Frontend Security, State Architecture & Rendering Patterns

Comprehensive engineering reference for building maintainable, secure, and performant web and mobile applications.

## When to Apply

Apply these rules when:
- Designing component communication or selecting state management strategies.
- Handling data fetching, caching, prefetching, or API synchronization with TanStack Query.
- Syncing UI state with URL search parameters (`nuqs`).
- Auditing security vulnerabilities (XSS, CSRF, AI Prompt Injections, MCP security, IDOR/BOLA).
- Choosing rendering and hydration models (SSR, Streaming Suspense, Server Components, Islands).
- Integrating automated API schema generation (OpenAPI + Orval) and runtime validation (Zod).

---

## 1. Security Rules

### XSS Prevention & AI Sanitization
- Never inject unescaped HTML or LLM responses directly into the DOM.
- Sanitize all rendered external markdown and user content with the Sanitizer API or DOMPurify.
- Enforce strict Content Security Policy (CSP) headers without `unsafe-inline`.

### CSRF & Access Control
- Set `SameSite=Lax` / `SameSite=Strict` on session cookies.
- Never use client-side visual hiding as an authorization check; enforce all RBAC/ABAC on the server/API layer.

### Parse at the Edge
- Validate all incoming network payloads, local storage, and search params with Zod schemas:
  ```ts
  import { z } from 'zod';
  const UserSchema = z.object({ id: z.string(), name: z.string().min(1) });
  type User = z.infer<typeof UserSchema>;
  ```

---

## 2. Component Communication & State Guidelines

### Choose by Distance & Persistence
- **Adjacent Siblings:** Lift state up to closest parent; use props and callbacks.
- **Deep Hierarchies:** Use Component Composition (`children` or slots) to eliminate prop drilling without adding global state.
- **URL View State:** Use `nuqs` (`useQueryState`) for filter bars, tabs, pagination, and modal dialogs.
- **Server Data:** Use TanStack Query. Never copy server responses into Zustand/Redux.
- **Ephemeral Signals:** Use `EventTarget` or `mitt` for fire-and-forget events (e.g., Toast triggers).

### TanStack Query Rules
- **Use `queryOptions`:** Avoid wrapping queries in custom hooks that require manual type generics:
  ```tsx
  export const productQueries = {
    all: () => queryOptions({ queryKey: ['products'], queryFn: fetchProducts }),
    detail: (id: string) => queryOptions({ queryKey: ['products', id], queryFn: () => fetchProduct(id) }),
  };
  ```
- **Type-Safe Conditional Queries:** Use `skipToken` instead of `enabled: false` with non-null assertions `!`.
- **Request Cancellation:** Pass `{ signal }` into `fetch` calls.

---

## 3. Hydration & Rendering Guardrails

- **Hydration Mismatches:** Avoid rendering client-only APIs (`window`, `localStorage`, non-deterministic dates) on initial server pass.
- **Streaming SSR:** Wrap slow data components in `<Suspense fallback={<Skeleton />}>` to avoid blocking initial paint.
- **RSC Boundaries:** Keep database operations and secret handling in Server Components. Avoid placing `"use client"` high in the component tree.

---

## 4. Mobile (React Native / Expo) Optimization

- Use `@shopify/flash-list` with `estimatedItemSize` and `React.memo` for all list rendering.
- Animate only GPU properties (`transform`, `opacity`) with `react-native-reanimated`.
- Use `expo-image` for high-performance image decoding and disk caching.
- Wrap layouts with `react-native-safe-area-context`.
