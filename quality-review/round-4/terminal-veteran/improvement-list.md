# Terminal Veteran Improvement List - Round 4

## Priority 1 (High Impact)

1. **Add Structured Logging**
   - Use `pino`, `winston`, or similar
   - Add levels: debug/info/warn/error
   - Include: timestamp, level, message, context
   - Impact: Production observability

2. **Implement Circuit Breaker**
   - Track failure rates per executor
   - Open circuit after threshold
   - Auto-retry after cooldown
   - Impact: Resilience

3. **Add Correlation IDs**
   - Generate ID at request start
   - Propagate through call chain
   - Include in all log entries
   - Impact: Debugging

## Priority 2 (Medium Impact)

4. **Add Health Check Endpoint**
   - `/health` with component status
   - Include executor health, memory, uptime
   - Impact: Monitoring

5. **Implement Graceful Shutdown**
   - Handle SIGTERM/SIGINT
   - Drain connections before exit
   - Impact: Zero-downtime deploys

6. **Add Metrics Export**
   - Prometheus-compatible metrics
   - Request latency, error rates
   - Impact: Monitoring
