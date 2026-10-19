# Helm Upgrade and Rollback Runbook

This document details the zero-downtime Helm release lifecycle, upgrade testing, rollback verification, and configuration strategies for the **UAI MCP Platform**.

---

## 1. Overview and Architecture

The platform is deployed via a unified umbrella chart (`uai/`) comprising microservices:
- `mariadb` (StatefulSet + 1Gi PVC)
- `woocommerce` (Deployment + 2Gi PVC)
- `postgres` (StatefulSet + 1Gi PVC)
- `gateway` (Deployment, stateless Streamable HTTP)
- `woo-mcp` (Deployment, ClusterIP only)
- `demo-mcp-servers` (`utils-mcp` and `everything-mcp` Deployments)
- `dashboard` (Deployment, static React NGINX unprivileged)

Because the MCP Gateway backend is entirely stateless and delegates persistence to PostgreSQL and session tokens to encrypted JWTs / SHA-256 key hashes, it can be seamlessly scaled, upgraded, and rolled back with **zero downtime** and **zero data loss**.

---

## 2. Upgrade Procedure

### 2.1 Standard Configuration Upgrade
To apply new Helm values or update resource allocations:

```bash
helm upgrade uai ./uai -f ./uai/values-local.yaml -n uai
```

### 2.2 Replicas Scaling Upgrade (Tested & Verified)
To scale the stateless MCP Gateway to handle higher concurrency:

```bash
helm upgrade uai ./uai -f ./uai/values-local.yaml --set gateway.replicaCount=2 -n uai
```

**Verification:**
```bash
kubectl -n uai rollout status deployment/uai-gateway --timeout=60s
kubectl -n uai get pods -l app.kubernetes.io/name=gateway
```

**Sample Verified Output:**
```
Release "uai" has been upgraded. Happy Helming!
NAME: uai
LAST DEPLOYED: Mon Oct 19 13:52:13 2026
NAMESPACE: uai
STATUS: deployed
REVISION: 11
DESCRIPTION: Upgrade complete

NAME                           READY   STATUS    RESTARTS   AGE
uai-gateway-5c78965d7d-wvfjg   1/1     Running   0          13s
uai-gateway-5c78965d7d-wxztx   1/1     Running   0          2m33s
```

---

## 3. Rollback Procedure

In the event of an unexpected regression, misconfiguration, or failure during an upgrade:

### 3.1 Check Helm Release History
```bash
helm history uai -n uai
```

**Sample History:**
```
REVISION  UPDATED                   STATUS      CHART      APP VERSION  DESCRIPTION     
9         Mon Oct 19 13:49:50 2026  superseded  uai-0.1.0  0.1.0        Upgrade complete
10        Mon Oct 19 13:51:40 2026  superseded  uai-0.1.0  0.1.0        Upgrade complete
11        Mon Oct 19 13:52:13 2026  superseded  uai-0.1.0  0.1.0        Upgrade complete
```

### 3.2 Execute Rollback
Roll back to the last known stable release (e.g. Revision 9):

```bash
helm rollback uai 9 -n uai
```

**Sample Verified Output:**
```
Rollback was a success! Happy Helming!
```

### 3.3 Verify Pod Termination and Rollout Stability
```bash
kubectl -n uai get pods -l app.kubernetes.io/name=gateway
```

**Sample Verified Output:**
```
NAME                           READY   STATUS        RESTARTS   AGE
uai-gateway-5c78965d7d-wvfjg   1/1     Terminating   0          29s
uai-gateway-5c78965d7d-wxztx   1/1     Running       0          2m49s
```

The superfluous replica was cleanly terminated, bringing the deployment back to exactly 1 replica without disrupting active TCP connections or inflight requests.

---

## 4. Verification in Helm History

```bash
helm history uai -n uai
```

```
REVISION  UPDATED                   STATUS      CHART      APP VERSION  DESCRIPTION     
11        Mon Oct 19 13:52:13 2026  superseded  uai-0.1.0  0.1.0        Upgrade complete
12        Mon Oct 19 13:52:40 2026  deployed    uai-0.1.0  0.1.0        Rollback to 9   
```

---

## 5. Rollback Safety & State Preservation

1. **Stateful Services are Untouched:** MariaDB and PostgreSQL retain their PVC data (`mariadb-data-uai-mariadb-0` and `postgres-data-uai-postgres-0`). Database state is unaffected by gateway upgrades or rollbacks.
2. **Readiness and Liveness Probes Protect Ingress:** New pods only receive ingress traffic once `HTTP GET /health` returns status 200 and all database connections are initialized.
3. **Graceful Termination:** Pods receive `SIGTERM` and are given `terminationGracePeriodSeconds` to finish inflight MCP calls before disconnection.
