# Non-goals

Version 0 does not implement registration, authentication, vehicles,
organizations, branches, services, pricing, bookings, queues, reviews,
notifications, payments, maps, analytics, or production deployment.

The architecture intentionally excludes microservices, GraphQL, MongoDB, Kafka,
RabbitMQ, Kubernetes, Elasticsearch, Redux, Redis, and a large UI component
library. These technologies are not prerequisites for the current product
shape and would add operational or conceptual cost without a Version 0 use case.

Exact queue-time guarantees and replacement of a business's accounting system
are not product promises.
