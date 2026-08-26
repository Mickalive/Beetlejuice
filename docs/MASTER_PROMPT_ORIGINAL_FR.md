PROMPT MAÎTRE — AGENTIC FINOPS / AGENTIC FACTORY OPTIMIZER
PRIVACY-FIRST DATA NETWORK

MISSION

Construire un produit commercial installable d’abord sur GitHub permettant de mesurer puis réduire le coût réel des workflows de coding agents.

Le produit ne doit PAS être un simple dashboard de tokens.

La métrique fondamentale est :

    TOTAL ECONOMIC COST / SUCCESSFUL OUTCOME

Exemples :

    $ / PR mergée
    $ / issue résolue
    $ / tâche acceptée
    temps / tâche acceptée
    taux de réussite / dollar

Le système doit mesurer l’ensemble de la chaîne :

    tâche
    → agent
    → modèle
    → contexte
    → outils
    → CI
    → tests
    → retries
    → reviewers/auditeurs
    → PR
    → résultat final

OBJECTIF BUSINESS

V1 :
    instrumentation
    + détection de gaspillage certain
    + coût par résultat

V2 :
    autotuning local par client/repository

V3 :
    apprentissage cross-customer sur données réellement non-rattachables

V4 :
    benchmark et moteur universel d’optimisation de systèmes agentiques

La V1 doit être conçue dès le premier commit afin de produire les données nécessaires aux V3/V4.

Ne jamais construire une V1 dont le modèle de données devra être entièrement refait plus tard.


==================================================
1. PRINCIPE ABSOLU DE CONFIDENTIALITÉ
==================================================

La base globale destinée à l’apprentissage cross-customer ne doit PAS permettre de rattacher un événement à :

- une entreprise ;
- un compte GitHub ;
- une organisation GitHub ;
- un repository ;
- un développeur ;
- une branche ;
- un commit ;
- une pull request identifiable ;
- une issue identifiable ;
- un utilisateur ;
- une adresse IP ;
- un domaine ;
- un nom de projet.

Il ne suffit PAS de remplacer :

    acme-corp

par :

    customer_8742

Cela reste un identifiant stable et donc potentiellement rattachable.

Le global learning dataset doit être conçu comme :

    UNLINKABLE BY DEFAULT

Aucun stable customer_id global.

Aucun stable repository_id global.

Aucun stable developer_id global.

Aucun hash déterministe d’un repo, domaine, commit ou utilisateur.

Aucun identifiant permettant de regrouper les événements d’un même client dans la base globale.

Les analyses longitudinales propres à un client doivent rester dans son espace tenant/local.


==================================================
2. SÉPARER TROIS COUCHES DE DONNÉES
==================================================

ARCHITECTURE OBLIGATOIRE :

A. SOURCE DATA

Chez GitHub / client :

    code
    issues
    PR
    commits
    logs
    workflows
    prompts éventuels
    traces
    résultats

Ces données peuvent être nécessaires temporairement au fonctionnement du produit.

Elles ne doivent jamais être confondues avec le dataset global.


B. TENANT ANALYTICS

Espace isolé propre au client.

Peut contenir les relations nécessaires pour produire :

    historique du repo
    évolution des coûts
    comparaison avant/après
    expériences locales
    autotuning local
    attribution aux workflows

Les données doivent être :

    tenant-isolated
    chiffrées
    minimisées
    avec politique de rétention explicite.


C. GLOBAL LEARNING DATASET

Ne contient que des représentations abstraites suffisamment générales.

Exemple :

    task_class: bug_fix
    language_family: typed_js
    repo_size_bucket: medium
    files_touched_bucket: 5-10
    dependency_complexity: medium

    agent_family: coding_agent
    model: MODEL_X
    orchestration_pattern: builder_reviewer

    input_tokens_bucket: 100k-250k
    output_tokens_bucket: 10k-25k

    inference_cost_bucket: 2-5 USD
    ci_cost_bucket: 0.5-2 USD
    total_cost_bucket: 5-10 USD

    tool_calls_bucket: 20-50
    retries: 2
    validation_layers: 2

    duration_bucket: 30-60 min

    outcome:
        accepted: true
        ci_success: true
        human_rework_bucket: low
        short_term_revert: false

AUCUN contenu source n’est nécessaire dans ce dataset.


==================================================
3. CE QUI NE DOIT JAMAIS ENTRER DANS LE DATASET GLOBAL
==================================================

Interdiction par défaut de conserver globalement :

- code source ;
- diff brut ;
- prompts bruts ;
- issue text ;
- PR description ;
- commentaires ;
- logs textuels ;
- stack traces contenant paths/secrets ;
- filenames ;
- repository names ;
- organisation names ;
- emails ;
- usernames ;
- IP ;
- URLs privées ;
- secrets ;
- API keys ;
- commit hashes ;
- branch names ;
- exact timestamps si inutiles ;
- noms de produits internes ;
- noms de clients ;
- données personnelles.

La classification sémantique doit idéalement être effectuée AVANT l’export.

Exemple :

    "Fix broken JWT refresh in Acme payment gateway"

devient seulement :

    task_type = bug_fix
    subsystem = authentication
    complexity = medium

Le texte original n’entre pas dans le dataset global.


==================================================
4. ÉVITER LES EMPREINTES RÉIDENTIFIANTES
==================================================

Même sans nom de client, une combinaison rare de caractéristiques peut permettre une réidentification.

Le système doit donc prévoir un PRIVACY GATE.

Avant admission d’un record global :

1. supprimer les identifiants ;
2. généraliser les valeurs ;
3. bucketiser les grandeurs ;
4. détecter les combinaisons extraordinairement rares ;
5. supprimer ou généraliser les caractéristiques trop uniques ;
6. empêcher la conservation de fingerprints techniques inutiles.

Exemple :

NE PAS stocker :

    Rust 1.97
    38,742,991 LOC
    7 GPUs H200
    custom-agent-foobar-9
    2026-08-26 03:17:42

Préférer :

    rust
    repo_size = very_large
    accelerator_usage = yes
    orchestration = custom_multi_agent
    period = 2026-Q3

Lorsque nécessaire, utiliser des techniques supplémentaires adaptées :

    cohort thresholds
    aggregation
    suppression of rare categories
    privacy risk scoring
    éventuellement differential privacy pour les statistiques publiées

Ne jamais considérer qu’un simple hash produit de l’anonymat.


==================================================
5. CANONICAL AGENTIC TASK MODEL
==================================================

Ne pas construire le système autour de :

    github_action_run

Construire autour d’un concept vendor-neutral :

    AGENTIC_TASK

Un AGENTIC_TASK peut contenir :

    TASK
      |
      +-- execution(s)
      |
      +-- agent(s)
      |
      +-- model invocation(s)
      |
      +-- tool invocation(s)
      |
      +-- compute
      |
      +-- CI
      |
      +-- validation(s)
      |
      +-- retry(s)
      |
      +-- human intervention
      |
      +-- outcome

GitHub est seulement le premier adapter.

Le modèle doit pouvoir ultérieurement recevoir :

    GitLab
    Bitbucket
    Claude Code
    Codex
    Cursor
    OpenCode
    Devin
    Jenkins
    Buildkite
    CircleCI
    Browserbase
    cloud compute
    custom agents


==================================================
6. MESURER LES OUTCOMES
==================================================

Une optimisation de tokens sans mesure du résultat est insuffisante.

Le système doit distinguer au minimum :

    task_started
    task_aborted
    task_failed
    PR_created
    PR_closed
    PR_merged
    CI_passed
    CI_failed
    human_rework
    retry
    revert

Lorsque possible :

    time_to_merge
    human_changes_after_agent
    number_of_review_cycles
    failure category
    reverted within N days

La métrique économique doit pouvoir montrer par exemple :

CONFIG A

    cost/run = $4
    success = 35%

    cost/successful outcome = $11.43


CONFIG B

    cost/run = $8
    success = 85%

    cost/successful outcome = $9.41

Donc le modèle apparemment plus cher est économiquement supérieur.

C’est ce que le produit doit révéler.


==================================================
7. V1 — INSTRUMENTATION + CERTAIN WASTE
==================================================

La V1 ne doit PAS prétendre connaître la configuration universellement optimale.

Elle doit détecter uniquement ce qui peut être démontré à partir des données du client.

Exemples :

- runs abandonnés ;
- runs superseded ;
- CI dupliquée ;
- test suite lancée inutilement plusieurs fois ;
- retries identiques après erreur déterministe ;
- agents continuant après disparition de leur objectif ;
- checks identiques répétés ;
- absence de cache évidente ;
- coûts de branches jamais utilisées ;
- modèles premium utilisés sur opérations déterministes lorsque cela est objectivement identifiable.

Premier résultat après installation :

    Last 7 days

    Agentic tasks: 318

    Total cost: $4,821

    Successful outcomes: 187

    Cost/successful outcome: $25.78

    Certainly wasted spend: $1,041

    Waste ratio: 21.6%

Le premier audit doit être READ-ONLY.


==================================================
8. V2 — LOCAL AUTOTUNING
==================================================

Le moteur expérimente à l’intérieur du système d’un client.

Exemple :

CURRENT

    workflow A
    $17.80 / merged PR
    72% success


EXPERIMENT

    targeted tests before full CI
    reviewer moved after deterministic checks


RESULT

    $12.10 / merged PR
    74% success

Le système doit garder :

    experiment
    baseline
    candidate
    confidence
    cost delta
    outcome delta

Le longitudinal détaillé reste tenant-local.

Le dataset global peut recevoir seulement :

    type of intervention
    abstract context
    aggregate before metrics
    aggregate after metrics
    effect size

sans identifiant permettant de savoir quel client a produit l’expérience.


==================================================
9. V3 — CROSS-CUSTOMER LEARNING
==================================================

Lorsque suffisamment de données existent :

    "Comparable workflows typically achieve
     25-35% lower cost/successful task
     using configuration class X."

Le moteur peut apprendre :

    P(success | task, architecture, model, workflow)

    expected_cost

    expected_latency

et optimiser quelque chose du type :

    maximize expected successful outcomes
    subject to budget
    latency
    reliability constraints


==================================================
10. INCENTIVE À CONTRIBUER
==================================================

Ne pas simplement demander :

    "Give us your telemetry."

Créer une contrepartie évidente.

Exemple :

    CONTRIBUTE PRIVACY-SAFE PERFORMANCE DATA

et obtenir :

    industry benchmarks
    percentile ranking
    cross-model comparisons
    recommended configuration ranges
    early access to global optimizer

Exemple client :

    Your cost/merged-task:
    $18.30

    Comparable workflows:
    median $13.20

    percentile:
    79th

Le réseau doit être utile au participant lui-même.


==================================================
11. DATA RIGHTS
==================================================

Ne jamais supposer que l’installation de l’application donne automatiquement le droit :

- d’entraîner des modèles commerciaux ;
- de vendre des datasets ;
- de fournir les données à des tiers ;
- de fournir les données à des frontier labs.

Séparer techniquement :

    PRODUCT TELEMETRY
    GLOBAL BENCHMARK CONTRIBUTION
    EXTERNAL RESEARCH / DATA LICENSING

L’architecture doit permettre des consentements/conditions distincts si nécessaire.

Une future collaboration avec :

    OpenAI
    Anthropic
    Google DeepMind
    xAI
    Meta
    autres labs

ne doit utiliser que des données ou statistiques pour lesquelles nous possédons effectivement les droits nécessaires.

Le produit doit pouvoir générer des datasets statistiques extrêmement intéressants sans exposer les données source des clients.


==================================================
12. FRONTIER LAB DATA PRODUCT — FUTURE
==================================================

Concevoir le schéma pour qu’il puisse un jour répondre à des questions comme :

- coût réel par tâche selon le modèle ;
- taux d’échec réel ;
- effet du contexte ;
- effet du cache ;
- effet des retries ;
- effet du nombre d’agents ;
- effet du reviewer ;
- coût des tool calls ;
- performance par classe de tâche ;
- escalade cheap model → frontier model ;
- efficacité marginale du compute ;
- taux de succès par orchestration ;
- fréquence des tâches abandonnées ;
- relation coût / qualité / durée ;
- architectures multi-agent réellement efficaces.

Cela peut constituer un actif de recherche et de marché très important.

Mais ne jamais compromettre la confidentialité pour maximiser la richesse du dataset.


==================================================
13. SPIDER / RESEARCH EXPORT
==================================================

Prévoir un module d’export scientifique distinct.

BUT :

permettre d’étudier la dynamique des systèmes agentiques comme systèmes de transitions.

Un run peut abstraitement devenir :

    state_t
    action
    state_t+1
    cost
    latency
    success/failure

Cela peut ultérieurement permettre d’étudier notamment :

    attracteurs
    boucles
    métastabilité
    transitions
    barrières
    chemins efficaces
    committors
    entropie
    coût de nouveauté
    structures de trajectoires
    faible dimension effective
    règles de transition

IMPORTANT :

ne jamais mélanger automatiquement les données de ce produit avec les datasets scientifiques SPIDER existants.

Créer une exportation séparée et explicitement versionnée :

    AGENTIC_DYNAMICS_EXPORT

Les hypothèses scientifiques devront être testées indépendamment.

Le produit commercial ne doit jamais être conçu pour artificiellement confirmer une hypothèse SPIDER.


==================================================
14. DATA MODEL EXTENSIBILITY
==================================================

Tous les événements doivent être versionnés.

Exemple :

    schema_version
    event_version
    collector_version
    normalization_version

Le système doit supporter :

    migrations
    backward compatibility
    provenance
    reproducibility

sans conserver d’identifiant client global.


==================================================
15. SECURITY
==================================================

Appliquer :

    least privilege
    read-only default
    secret detection
    encryption in transit
    encryption at rest
    tenant isolation
    audit logs
    deletion workflows
    retention policies
    access control
    secure webhook verification

Aucun secret détecté ne doit être envoyé vers la couche analytique globale.


==================================================
16. DESIGN DU PRODUIT
==================================================

Installation initiale :

    GitHub App

Flow :

    Install
       ↓
    read-only observation
       ↓
    reconstruct agentic task economics
       ↓
    show cost/outcome
       ↓
    identify certain waste
       ↓
    recommend changes
       ↓
    optional PR/autotuning
       ↓
    measure actual savings

Time-to-value cible :

    moins de 5 minutes lorsque suffisamment d’historique GitHub est disponible.


==================================================
17. PREMIER WOW MOMENT
==================================================

Le dashboard principal ne doit PAS commencer par :

    Tokens: 18,472,991

Commencer par :

    LAST 30 DAYS

    Agentic engineering cost:
    $8,412

    Accepted tasks:
    481

    Cost / accepted task:
    $17.49

    Certainly avoidable spend:
    $2,108

    Potential savings:
    25.1%

Puis expliquer exactement pourquoi.


==================================================
18. MONÉTISATION
==================================================

Prévoir techniquement plusieurs modèles :

    free visibility tier

    fixed SaaS subscription

    savings-based fee

Exemple potentiel :

    We save you $1,000.
    We keep $200.

Mais ne pas figer prématurément le pricing dans l’architecture.


==================================================
19. ANTI-GOALS
==================================================

Ne PAS construire :

- une plateforme gigantesque avant V1 ;
- un dashboard générique LLM FinOps ;
- un remplacement de GitHub ;
- un orchestrateur complet dès le jour 1 ;
- un système nécessitant des millions de runs pour fonctionner ;
- une architecture reposant sur la collecte de code client ;
- un data lake de données sensibles ;
- un produit qui prétend optimiser ce qu’il ne peut pas mesurer.

La V1 doit fournir une valeur autonome avec un seul client.


==================================================
20. TESTS CRITIQUES
==================================================

Créer des tests automatisés démontrant notamment :

PRIVACY TEST

Aucun GlobalLearningRecord ne contient :

    customer identifier
    repo identifier
    developer identifier
    commit hash
    PR number
    exact path
    prompt
    code
    secret
    URL privée


REIDENTIFICATION TEST

Créer volontairement des événements rares et vérifier que le Privacy Gate :

    généralise
    bucketise
    supprime

avant export.


TENANT ISOLATION TEST

Aucun client ne peut récupérer les données tenant d’un autre.


COST ACCOUNTING TEST

Vérifier :

    inference + tools + CI + compute = total cost


OUTCOME ATTRIBUTION TEST

Vérifier qu’un coût est correctement associé au résultat final.


SCHEMA COMPATIBILITY TEST

Un agent provenant d’une nouvelle plateforme doit pouvoir être représenté sans modifier le concept fondamental AGENTIC_TASK.


==================================================
21. LIVRABLES
==================================================

Produire au minimum :

1. architecture documentée ;
2. canonical schema ;
3. privacy architecture ;
4. GitHub App prototype ;
5. event ingestion ;
6. cost attribution ;
7. outcome attribution ;
8. tenant analytics ;
9. global privacy-safe exporter ;
10. privacy gate ;
11. premier waste detector ;
12. dashboard initial ;
13. tests ;
14. documentation ;
15. synthetic dataset permettant de tester le système avant d’avoir de vrais clients.


==================================================
22. PRINCIPE DIRECTEUR
==================================================

La société ne doit pas dépendre d’un dataset massif pour créer sa première valeur.

Mais chaque utilisation réelle doit améliorer la possibilité de construire le dataset massif futur.

Autrement dit :

    VALUE TODAY
        +
    DATA ASSET TOMORROW

sans sacrifier :

    CUSTOMER CONFIDENTIALITY.


==================================================
23. NORTH STAR
==================================================

À terme, le système doit pouvoir répondre :

    "For this class of agentic work,
     what configuration produces the greatest
     accepted useful work per dollar?"

Et le client doit pouvoir l’utiliser sans jamais avoir à révéler son code à la base globale.


FINAL REQUIREMENT

Construire un vrai produit commercial minimal, pas une démonstration architecturale.

Lorsque complexité future et simplicité V1 entrent en conflit :

    préserver le schéma de données,
    préserver les frontières privacy,
    préserver la compatibilité future,

mais choisir la solution d’exécution la plus simple permettant de livrer une V1 fonctionnelle.
