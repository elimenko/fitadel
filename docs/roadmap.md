# Roadmap

Fitadel is built in phases. Phases 0–5 make up the MVP.
UI/UX is designed mobile-first on every platform.

## MVP

### Phase 0: Foundations

- [x] Nx workspace, repository conventions
- [x] Architecture decision records
- [x] CI with `nx affected`
- [x] Local infrastructure with Docker Compose

### Phase 1: Food catalog

- [x] Food catalog service with search
- [x] Import from Open Food Facts
- [x] Barcode lookup (catalog first, then Open Food Facts live)
- [x] Custom and manually entered foods (users until Phase 2: development headers)
- [x] Observability baseline: OpenTelemetry instrumentation, local metrics/logs/traces stack

### Phase 2: Identity

- [ ] OpenID Connect provider (authorization code + PKCE)
- [ ] User accounts and sign-in
- [ ] Email verification and password reset
- [ ] API gateway (Envoy): routing, token validation at the edge, rate limiting
- [ ] Sign-in with Google (federated identity)

### Phase 3: Goals and diary

- [ ] Goals with a deficit or surplus in % or kcal → daily calorie budget
- [ ] Food diary with daily totals
- [ ] Event-driven integration between services (Kafka)
- [ ] Distributed tracing across services and Kafka; dashboards and alert rules

### Phase 4: Web

- [ ] Design system (tokens, components), wireframes and example pages; shared by the
      web, Android and the sign-in screens
- [ ] Module Federation shell and micro-frontends
- [ ] English and Russian localization
- [ ] Infrastructure as code on AWS (Terraform)

### Phase 5: Android

- [ ] React Native app sharing domain libraries with the web
- [ ] Barcode scanning with the camera
- [ ] Mobile Module Federation (Re.Pack)

## After the MVP

### Phase 6: AI assistant

- [ ] Bring-your-own-key support for Anthropic and OpenAI
- [ ] Generic foods from USDA FoodData Central, with translated names
- [ ] The assistant proposes diary entries; the user confirms them.
      The app stays the system of record.

### Phase 7: Wearables and engagement

- [ ] Activity sync via Android Health Connect (Garmin, Oura)
- [ ] Activity-adjusted calorie budget
- [ ] Push notifications and progress charts

### Phase 8: Production

- [ ] Kubernetes on AWS (EKS), continuous delivery
- [ ] Production monitoring and alerting (SLOs, notifications)
- [ ] Security hardening, cost controls
