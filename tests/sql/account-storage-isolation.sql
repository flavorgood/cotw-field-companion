-- Executed on actual Neon grindzone database as an administrative test operator.
-- The tested queries run after SET LOCAL ROLE grindzone_runtime.
-- Successful fixture writes are undone by a deliberately caught subtransaction exception.
DO $test$
DECLARE
 st text:=repeat('f',64); ot text:=repeat('a',64); dt text:=repeat('d',64);
 sid uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); old_epoch uuid:=gen_random_uuid(); affected integer;
BEGIN
 IF current_database()<>'grindzone' THEN RAISE EXCEPTION 'Wrong test database'; END IF;
 EXECUTE 'SET LOCAL ROLE grindzone_runtime';
 IF current_user<>'grindzone_runtime' THEN RAISE EXCEPTION 'Runtime role not active'; END IF;
 IF NOT EXISTS(SELECT 1 FROM grindzone.gz_binding_meta WHERE name='schema' AND value='grindzone.account-sources.postgres.v1') THEN RAISE EXCEPTION 'Schema marker missing'; END IF;
 IF has_schema_privilege(current_user,'grindzone','CREATE') OR has_schema_privilege(current_user,'public','CREATE') OR has_database_privilege(current_user,current_database(),'CREATE') THEN RAISE EXCEPTION 'Runtime can modify schemas'; END IF;
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='neon_auth') AND has_schema_privilege(current_user,'neon_auth','USAGE') THEN RAISE EXCEPTION 'Runtime can access provider auth schema'; END IF;
 BEGIN
  INSERT INTO grindzone.gz_binding_meta VALUES ('unauthorized','test');
  RAISE EXCEPTION 'Runtime changed administrative metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO grindzone.gz_source_generations VALUES(st,1,dt);
  INSERT INTO grindzone.gz_source_bindings VALUES(sid,st,ot,'Disposable isolation test',1,old_epoch,1,1);
  INSERT INTO grindzone.gz_binding_requests VALUES(req,repeat('e',64),ot,repeat('c',64),st,dt,1,'Disposable isolation test','Synthetic account',9000000000000,'pending',NULL);
  BEGIN
   INSERT INTO grindzone.gz_source_bindings VALUES(gen_random_uuid(),st,repeat('b',64),'Other owner',1,gen_random_uuid(),1,1);
   RAISE EXCEPTION 'Duplicate source ownership accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
   UPDATE grindzone.gz_binding_requests SET state='invented' WHERE id=req;
   RAISE EXCEPTION 'Invalid approval state accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
   UPDATE grindzone.gz_source_generations SET generation=0 WHERE source_tag=st;
   RAISE EXCEPTION 'Invalid generation accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
   UPDATE grindzone.gz_source_bindings SET version=9007199254740992 WHERE source_id=sid;
   RAISE EXCEPTION 'Unsafe version accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE grindzone.gz_source_bindings SET active=0,version=version+1,epoch=gen_random_uuid() WHERE source_id=sid AND owner_tag=ot AND version=2;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Stale version changed source'; END IF;
  UPDATE grindzone.gz_source_bindings SET active=0,version=version+1,epoch=gen_random_uuid() WHERE source_id=sid AND owner_tag=ot AND version=1;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 OR NOT EXISTS(SELECT 1 FROM grindzone.gz_source_bindings WHERE source_id=sid AND active=0 AND version=2 AND epoch<>old_epoch) THEN RAISE EXCEPTION 'Versioned unlink did not invalidate lease'; END IF;
  RAISE SQLSTATE 'ZX001' USING MESSAGE='Rollback disposable test rows';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
 IF EXISTS(SELECT 1 FROM grindzone.gz_source_bindings WHERE source_id=sid) OR EXISTS(SELECT 1 FROM grindzone.gz_binding_requests WHERE id=req) OR EXISTS(SELECT 1 FROM grindzone.gz_source_generations WHERE source_tag=st) THEN RAISE EXCEPTION 'Disposable rows were retained'; END IF;
 EXECUTE 'RESET ROLE';
END $test$;
