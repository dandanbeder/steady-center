CREATE POLICY "ai_prefs_own_delete"
ON public.ai_prefs
FOR DELETE
TO authenticated
USING (user_id = auth.uid());