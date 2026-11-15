# Changelog

## 1.0.0 (2026-11-15)


### Features

* **dsl:** add JSON Schema for the brush-stroke DSL with validator ([40d4979](https://github.com/isol178/gaka/commit/40d4979f20a45d35768070bfa87383ba455a5483))
* **evals:** add three-tier eval runner (deterministic, replay, live) ([a3cf165](https://github.com/isol178/gaka/commit/a3cf165a6d4e2d849a3911ad58c7918c71f39168))
* **harness:** add Google Gemini adapter via @google/genai ([861fb19](https://github.com/isol178/gaka/commit/861fb19c49455d62b190a120f4cd176ff94930f8))
* **harness:** add Painter-Critic loop, model adapters and capability profiles ([89702ea](https://github.com/isol178/gaka/commit/89702ea88acf30e226fea35fdb2fbad3e219d24b))
* **harness:** use official SDKs for Anthropic and OpenAI ([868afca](https://github.com/isol178/gaka/commit/868afca8fe448d9365eb2fc36e571e0350b23b68))
* **observer:** add Python observer for metrics, thumbnails and crops ([26c58b5](https://github.com/isol178/gaka/commit/26c58b58774401dec9b4db73538b030835e24578))
* **renderer:** add deterministic Canvas 2D renderer with seeded PRNG ([e741ef0](https://github.com/isol178/gaka/commit/e741ef074da3bef0f7ba912c7f8c16fd410d39c0))


### Bug Fixes

* address review findings on the dev-environment PR ([c8c1b7e](https://github.com/isol178/gaka/commit/c8c1b7e2d8f2174e1d945370aa94dceb7b7ab547))
* **claude:** guard shell writes to baselines and secrets; tighten CI/CD ([90344bb](https://github.com/isol178/gaka/commit/90344bb0281bc40210c096711fc0e5b9d221ff3a))
* **dsl:** extract fenced JSON without a backtracking regex ([d854942](https://github.com/isol178/gaka/commit/d8549423892c34da7d6a339be6e6736b97da3f6b))
* **harness:** handle truncated and refused replies, create baseline dir ([b7ac376](https://github.com/isol178/gaka/commit/b7ac376685b2380a334674f604f71ba40ad2ac23))
* **harness:** resolve adapter config before the session starts ([a07f6a8](https://github.com/isol178/gaka/commit/a07f6a81548e703ceae2de471f1cad63950f753d))
