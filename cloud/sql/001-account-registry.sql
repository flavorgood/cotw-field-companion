-- Applied once to the separate grindzone database on 2026-09-21.
-- Prerequisites: restricted grindzone_runtime role and admin-owned grindzone schema.
-- Do not point this migration at neondb or replay it against an existing registry.
DO $gz$
BEGIN
 IF current_database()<>'grindzone' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 CREATE TABLE grindzone.gz_binding_meta (name text PRIMARY KEY, value text NOT NULL);
 INSERT INTO grindzone.gz_binding_meta(name,value) VALUES ('schema','grindzone.account-sources.postgres.v1');
 CREATE TABLE grindzone.gz_source_bindings (
  source_id uuid PRIMARY KEY,
  source_tag text NOT NULL UNIQUE CHECK(source_tag ~ '^[a-f0-9]{64}$'),
  owner_tag text NOT NULL CHECK(owner_tag ~ '^[a-f0-9]{64}$'),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
  version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
  epoch uuid NOT NULL,
  active smallint NOT NULL CHECK(active IN(0,1)),
  linked_at bigint NOT NULL CHECK(linked_at BETWEEN 0 AND 9007199254740991)
 );
 CREATE INDEX gz_source_owner ON grindzone.gz_source_bindings(owner_tag,active);
 CREATE TABLE grindzone.gz_binding_requests (
  id uuid PRIMARY KEY,
  request_tag text NOT NULL UNIQUE CHECK(request_tag ~ '^[a-f0-9]{64}$'),
  owner_tag text NOT NULL CHECK(owner_tag ~ '^[a-f0-9]{64}$'),
  session_tag text NOT NULL CHECK(session_tag ~ '^[a-f0-9]{64}$'),
  source_tag text NOT NULL CHECK(source_tag ~ '^[a-f0-9]{64}$'),
  device_tag text NOT NULL CHECK(device_tag ~ '^[a-f0-9]{64}$'),
  generation bigint NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
  display_name text NOT NULL CHECK(length(display_name)<=80),
  expires bigint NOT NULL CHECK(expires BETWEEN 1 AND 9007199254740991),
  state text NOT NULL CHECK(state IN('pending','pc_approved','approved','rejected','cancelled')),
  source_id uuid
 );
 CREATE INDEX gz_binding_request_scope ON grindzone.gz_binding_requests(source_tag,device_tag,state);
 CREATE INDEX gz_binding_request_expiry ON grindzone.gz_binding_requests(expires);
 CREATE TABLE grindzone.gz_source_generations (
  source_tag text PRIMARY KEY CHECK(source_tag ~ '^[a-f0-9]{64}$'),
  generation bigint NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
  device_tag text NOT NULL CHECK(device_tag ~ '^[a-f0-9]{64}$')
 );
 REVOKE ALL ON ALL TABLES IN SCHEMA grindzone FROM PUBLIC;
 GRANT SELECT ON grindzone.gz_binding_meta TO grindzone_runtime;
 GRANT SELECT,INSERT,UPDATE,DELETE ON grindzone.gz_source_bindings,grindzone.gz_binding_requests,grindzone.gz_source_generations TO grindzone_runtime;
END $gz$;
