# AWS Practical Exercises Implementation Reference

This document consolidates requirements from:
- `Week4_Practical Exercise 1_ AWS Computing Services_ Cloud Computing (2610).pdf`
- `Practical Exercise 2_ AWS Storage Services_ Cloud Computing (2610).pdf`
- `Practical Exercise 3_ AWS Database Services_ Cloud Computing (2610).pdf`

Use this as the implementation and evidence checklist for the project.

## 1) Scope and Learning Outcomes

### Exercise 1 (Computing Services)
- Provision EC2 infrastructure in allowed regions.
- Configure Linux VM access and runtime.
- Host a simple web app on VM (Apache/PHP).
- Demonstrate client-server communication across two VMs.

### Exercise 2 (Storage Services)
- Create and manage S3 buckets.
- Upload, download, copy, and delete S3 objects.
- Delete bucket after cleanup.

### Exercise 3 (Database Services)
- Model and manage DynamoDB tables.
- Perform CRUD operations on items.
- Query and scan DynamoDB data.
- Use both console workflows and SDK-based operations.

## 2) Mandatory Constraints (Across Exercises)

- **Region restriction:** use `us-east-1` or `us-west-2` only (AWS Academy rule).
- **Credentials:** AWS Academy credentials are short-lived; refresh on lab restart.
- **Evidence expectation:** retain screenshots/logs of successful provisioning and operation outputs.

## 3) Consolidated Technical Checklist

## 3.1 Compute (EC2/VM) Checklist

- [ ] Create EC2 instance (Ubuntu 24.04 LTS, typically `t3.micro`).
- [ ] Configure keypair properly (`vockey` in `us-east-1`, region-specific key otherwise).
- [ ] Configure security group with required inbound rules:
  - [ ] SSH (22)
  - [ ] HTTP (80)
  - [ ] HTTPS (443)
  - [ ] All TCP (practical lab requirement)
  - [ ] ICMP IPv4 (practical lab requirement)
- [ ] Connect via SSH from local machine.
- [ ] Install OpenJDK 17 and verify with `java -version`.
- [ ] Install Apache2 + PHP and confirm web server responds.
- [ ] Deploy `index.php` and verify page output in browser.
- [ ] Duplicate instance (server/client pattern).
- [ ] Deploy and run sample TCP server/client Java files across two VMs.

## 3.2 Storage (S3) Checklist

- [ ] Create unique S3 bucket.
- [ ] Upload string object (e.g., `copied-string.txt`).
- [ ] Upload file object (e.g., `copied-file.txt` from local file).
- [ ] Download/retrieve object contents.
- [ ] Copy object within bucket (e.g., `copied-file.txt` -> `copied-again-file.txt`).
- [ ] Delete single object.
- [ ] Delete multiple objects in one request.
- [ ] Delete bucket after object cleanup.

## 3.3 Database (DynamoDB) Checklist

### Music table (console-focused tasks)
- [ ] Create table `Music` with:
  - [ ] Partition key: `Artist` (String)
  - [ ] Sort key: `SongTitle` (String)
- [ ] Insert sample items with additional attributes (e.g., `AlbumName`, `Year`).
- [ ] Update an existing item.
- [ ] Query by partition key only.
- [ ] Query by partition + sort conditions.

### Movies table (SDK-focused tasks)
- [ ] Run DynamoDB Local (or remote DynamoDB where applicable).
- [ ] Create table `Movies` with:
  - [ ] Partition key: `year` (Number)
  - [ ] Sort key: `title` (String)
- [ ] Load sample movie JSON data.
- [ ] Perform CRUD item operations.
- [ ] Perform atomic increment update.
- [ ] Perform conditional update/delete operations.
- [ ] Run `Query` and `Scan` patterns (including expression attribute names/values).

## 4) Project Mapping (music-app)

Current backend (`backend/server.js`) partially covers Exercise 3 ideas:
- Existing: DynamoDB connectivity and read endpoint (`/songs`) using `scan`.
- Missing for full alignment:
  - CRUD APIs (create/update/delete) for table items.
  - Query-first patterns using key conditions (instead of only table scan).
  - Robust validation and error handling for expected DynamoDB failures.

Current project appears to have no implemented S3 feature path yet:
- Missing for Exercise 2 alignment:
  - S3 upload/download APIs.
  - S3 object lifecycle operations (copy/delete).
  - Optional file metadata handling.

Current project has no EC2 deployment artifacts in repo:
- Missing for Exercise 1 alignment:
  - Deployment runbook for EC2.
  - VM provisioning evidence and service startup commands.
  - Optional automation scripts.

## 5) Recommended Implementation Plan for This Project

## Phase A - Backend Hardening (DynamoDB first)
- [ ] Replace full-table scans with key-based query endpoints where possible.
- [ ] Add endpoints:
  - [ ] `GET /songs`
  - [ ] `GET /songs/:artist/:songTitle`
  - [ ] `POST /songs`
  - [ ] `PUT /songs/:artist/:songTitle`
  - [ ] `DELETE /songs/:artist/:songTitle`
- [ ] Add request validation and consistent error response shape.
- [ ] Use env-driven config (`AWS_REGION`, table name).

## Phase B - S3 Integration
- [ ] Add S3 client configuration.
- [ ] Add API endpoints:
  - [ ] `POST /files/upload` (or presigned URL flow)
  - [ ] `GET /files/:key` (download/get metadata)
  - [ ] `POST /files/:key/copy`
  - [ ] `DELETE /files/:key`
- [ ] Store file references in DynamoDB records if needed.

## Phase C - Deployment and Demonstration (EC2)
- [ ] Prepare EC2 deployment steps for backend/frontend.
- [ ] Configure security group minimally for app + SSH.
- [ ] Verify app reachable via public DNS/IP.
- [ ] Capture final evidence pack.

## 6) Suggested Environment Variables

Use `.env` values similar to:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN`
- `AWS_REGION=us-east-1`
- `DYNAMODB_TABLE=Music` (or `music`, but keep naming consistent)
- `S3_BUCKET=<your-unique-bucket-name>`
- `PORT=3001`

## 7) Evidence Pack Checklist (for submission/demo)

- [ ] Screenshot: EC2 instance(s) running in allowed region.
- [ ] Screenshot: security group rules.
- [ ] Terminal proof: SSH connected + Java/Apache installed.
- [ ] Browser proof: hosted page reachable on EC2.
- [ ] Screenshot/log: S3 bucket created + objects uploaded/downloaded.
- [ ] Screenshot/log: object copy/delete and bucket deletion flow.
- [ ] Screenshot/log: DynamoDB table(s) with sample items.
- [ ] API test captures (Postman/curl) for CRUD endpoints.
- [ ] Notes of issues encountered + how fixed (reflection-ready).

## 8) Known Pitfalls and Prevention

- Credentials expired -> refresh AWS Academy credentials and restart app.
- Wrong AWS region -> set `AWS_REGION` to `us-east-1` or `us-west-2`.
- DynamoDB access denied -> confirm region and credentials profile/session.
- S3 bucket name conflict -> choose globally unique bucket name.
- Overusing scan -> use query by key for scalable access patterns.
- Java JAXB errors in old SDK tutorials -> add JAXB dependencies when using newer JDKs in Java lab projects.

## 9) Definition of Done (Project-Aligned)

You can consider this practical-aligned project complete when:
- DynamoDB CRUD + query endpoints are working and tested.
- S3 object operations are implemented and demonstrated.
- App is deployed and reachable on EC2 (or deployment steps are fully validated).
- Evidence pack is complete and traceable to exercise requirements.

