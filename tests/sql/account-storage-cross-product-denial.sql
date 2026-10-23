-- Read-permission checks only on existing neondb; no application rows read or changed.
DO $test$
DECLARE target text; denied integer:=0;
BEGIN
 IF current_database()<>'neondb' THEN RAISE EXCEPTION 'Wrong isolation-check database'; END IF;
 EXECUTE 'SET LOCAL ROLE grindzone_runtime';
 FOREACH target IN ARRAY ARRAY['users','sessions','user_profiles'] LOOP
  BEGIN
   EXECUTE format('SELECT 1 FROM public.%I LIMIT 0',target);
   RAISE EXCEPTION 'Unexpected cross-product SELECT permission: %',target;
  EXCEPTION WHEN insufficient_privilege THEN denied:=denied+1; END;
 END LOOP;
 IF denied<>3 THEN RAISE EXCEPTION 'Isolation assertion failed'; END IF;
 EXECUTE 'RESET ROLE';
END $test$;
