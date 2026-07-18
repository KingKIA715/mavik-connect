---
name: Mavik Connect end-to-end encryption design
description: How message/group-key encryption is architected in the mavik-connect artifact, and the tradeoffs behind it.
---

Mavik Connect messages are encrypted client-side so the server never sees plaintext content or group keys.

- Each user has an RSA-OAEP keypair. The private key lives only in `localStorage` (keyed per user id) and is never uploaded. Only the public key is sent to the server.
- Each group has one AES-GCM key generated client-side. It's wrapped (RSA-encrypted) once per member with that member's public key; the server stores only wrapped copies, never the raw group key.
- Encrypted message content is prefixed (`enc:`) so the client can distinguish encrypted vs. legacy/plaintext content when rendering.

**Why:** true E2E means the server must be structurally incapable of reading messages — it can only ever hold ciphertext and per-member wrapped keys.

**How to apply:** when adding new content types that need encryption (e.g. call metadata, file attachments), reuse the same group AES key + wrap-per-member pattern rather than inventing a new scheme. Members who join/get invited after the group key exists must have the key re-wrapped and shared for them specifically — don't assume key propagation is automatic just because they're a group member now.

**Known tradeoff (by design, communicated to user):** if a user loses their browser's localStorage (clears data, switches devices without migration), they permanently lose access to previously-shared group keys and thus old encrypted messages. This is accepted as the correct behavior for genuine E2E encryption, not a bug to silently work around.
