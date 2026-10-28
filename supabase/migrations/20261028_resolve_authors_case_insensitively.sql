CREATE OR REPLACE FUNCTION public.resolve_author(p_name text)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  cleaned_name text;
  resolved_author public.authors%ROWTYPE;
BEGIN
  cleaned_name := pg_catalog.btrim(p_name);
  IF cleaned_name IS NULL OR cleaned_name = '' THEN
    RAISE EXCEPTION 'Author name cannot be empty'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.lower(cleaned_name), 0)
  );

  SELECT author.*
  INTO resolved_author
  FROM public.authors AS author
  WHERE pg_catalog.lower(pg_catalog.btrim(author.name)) =
    pg_catalog.lower(cleaned_name)
  ORDER BY author.id
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.authors (name)
    VALUES (cleaned_name)
    RETURNING * INTO resolved_author;
  END IF;

  RETURN QUERY
  SELECT resolved_author.id, resolved_author.name;
END
$function$;

REVOKE ALL ON FUNCTION public.resolve_author(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_author(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_author(text) TO service_role;
