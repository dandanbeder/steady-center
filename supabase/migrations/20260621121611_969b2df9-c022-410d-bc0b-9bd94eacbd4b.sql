DROP POLICY IF EXISTS shares_update ON public.shares;
CREATE POLICY shares_update ON public.shares
FOR UPDATE TO authenticated
USING (
  resource_owner(resource_type, resource_id) = auth.uid()
  OR is_platform_admin()
  OR (resource_type = 'business' AND is_member(resource_id, 'admin'))
)
WITH CHECK (
  resource_owner(resource_type, resource_id) = auth.uid()
  OR is_platform_admin()
  OR (resource_type = 'business' AND is_member(resource_id, 'admin'))
);