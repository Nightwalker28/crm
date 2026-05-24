# Module Checklist

## Backend

- [ ] Model snippet added to `backend/app/modules/<area>/models.py`
- [ ] Schema snippet added to `backend/app/modules/<area>/schema.py`
- [ ] Repository created
- [ ] Service created
- [ ] Route created
- [ ] API router registered
- [ ] Migration created and reviewed
- [ ] Module key registered in seed/migration if needed
- [ ] Department/team/module availability defaults seeded if needed
- [ ] Role action permissions seeded if needed
- [ ] Module fields configured if needed
- [ ] Custom fields enabled if needed
- [ ] Recycle bin/restore integration added if the module is recoverable
- [ ] Activity log integration added for create/update/delete/restore
- [ ] Linked records are tenant-validated
- [ ] List/search/filter queries are tenant-scoped

## Frontend

- [ ] API hook/client file created
- [ ] Types created
- [ ] List page created
- [ ] Detail page created
- [ ] Create page created
- [ ] Edit page created
- [ ] Form component created
- [ ] Table/list component created
- [ ] Route metadata registered
- [ ] Sidebar/module nav canonical route registered if needed
- [ ] Module display metadata registered if needed
- [ ] Saved view/module view config registered
- [ ] Protected field registry updated if needed
- [ ] Permissions/access behavior checked through accessible modules
- [ ] Custom/module fields handled if needed
- [ ] Empty, loading, error, create, update, delete, and navigation states checked
