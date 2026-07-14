---
name: buf-setup
language: protobuf
category: tooling
tags: [protobuf, buf, grpc, lint, codegen]
description: Minimal buf v2 setup — module layout, STANDARD lint, breaking-change detection, remote-plugin codegen
test: buf lint
---

# Protobuf project setup with buf

## Problem

Raw `protoc` gives no linting, no breaking-change detection, and every
machine needs the right plugins installed. Proto layout conventions
(versioned packages, request/response naming) are easy to drift from
without a tool enforcing them.

## Solution

- **`buf.yaml` (v2)** declares one module rooted at `proto/`, with the
  `STANDARD` lint category and `FILE`-level breaking-change detection.
- **`proto/example/v1/user.proto`** shows the layout STANDARD enforces:
  directory mirrors the package (`example/v1` ⇔ `example.v1`), versioned
  package suffix, `Service`-suffixed service, one request/response message
  pair per RPC.
- **`buf.gen.yaml`** generates Go + gRPC stubs into `gen/` using remote
  plugins — nothing to install locally besides `buf` itself.

## Key points

- One dedicated request/response pair per RPC, even when they look
  redundant today — shared messages cannot evolve independently later.
- `buf breaking --against '.git#branch=main'` compares the working tree to
  the last pushed contract; run it before changing any published proto.
- Remote plugins (`buf.build/...`) pin codegen behavior in config instead
  of in each developer's toolchain.
- Generated code goes to `gen/` and stays out of version control here;
  in a real project, either commit it or publish via buf's BSR.

## How to run

```bash
buf lint
buf generate   # optional: writes Go stubs to gen/
```
