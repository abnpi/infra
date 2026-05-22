I need to design a strategy to move the schema.prisma between environments.

we have 2 databases one both prisma (postgres). first large second smaller - financial ledger

dev we have a single dev environment on aws 2x aurora RDS.
dev has smalll set of seed scripts. (we just ditched large and unmaintainable seed script and kept only necessery one to bootstrap the environemnt)

we have UAT environment


we have production


dev
should be throwable data - we can work with cloning UAT db into dev.
right now we do have like hundreds of migrations - essentially when somebody makes change to DB we even have precommit to prevent push it without making a migration file.
I am not sure about this

UAT - should be what it is for user acceptance. there should be way of building fake real data or perhaps even anonymize subset of prod db.


prod - it is financial DB and sensite data


I also plan to have SIT but this is not yet planned.


ATM we use github actions, but I heard people talking about moving to jenkins ( I guess for cost reasons. )


I need to prepare strategy for moving DB across.


my thoughts 
ditch dev migrations. - or have something like lower and upper dev and migration would be for upper dev. probably idiotic idea...


we are still on develop branch


cutting release - Github actions release - create release branch from develop -> PR to master -> here are migrations created to sync schema with UAT db
reviewer reviews it and potentially ads something to migrations
merge to master -> create tag
deploy tag - this will deploy migrations to prod. it should be identical to UAT so once we should be able to straight deploy - we only need to check it as part of pre-deploy.

please revise my strategy as per industry standards
