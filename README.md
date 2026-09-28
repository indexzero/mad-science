# mad-science

mad-science is a repository of coding projects, sorted into six
stages of maturity. The stage of a project ensures it gets the rigor that
its use requires, and no more.

A [mad science project](https://charlie.dev/w/1/016) starts as a bold idea about anything, big or small. You cannot forget the idea, so the only option left is to keep thinking about it and maybe one day build it.

## Layout

Each project is one directory:

```
stage/<N>/<project>/
```

`<N>` is the stage, from 0 to 5. `<project>` is a short name in lowercase.
To see the current projects, run `ls stage/*`.

## Stages

A project moves to a stage when it meets the entrance criteria of that stage:

| Stage | Status | Entrance criteria | Purpose |
|---|---|---|---|
| 0 | Idea. Not built. | None. | Refine the idea. |
| 1 | Designed. Not built. | A sound approach, stack, and architecture, written as a PROMPT.md or an orckit. | Plan the build. |
| 2 | Tried. Nothing depends on it. | An agent can build it unattended. A machine can check Done. | Build it one time and see. |
| 3 | Used. The design can change. | The build passes its Done. I use it like my skunkworks. | Learn from use. |
| 4 | Relied on. | It has dependents, mostly me. I use it regularly. | Grow it with care. |
| 5 | Stable. | Version 1.0.0 in semver. | Maintain it. |

The stage records maturity, not importance or potential value which are stored along with other metadata in the frontmatter of the `PROMPT.md` or `orckit`

The scale of a project sets the form of its plan. If one agent can finish the
project unattended from one `PROMPT.md`, the project is a toy. All other work
needs an [orckit](https://github.com/indexzero/orckit). The orckit lets that
work finish with little or no oversight.

A stage 0 directory can hold a long `PROMPT.md`. The stage records whether the
idea is sound. It does not record how much text exists.

## Examples

Start a project at stage 0:

```sh
mkdir -p stage/0/my-idea
$EDITOR stage/0/my-idea/PROMPT.md
```

When a project meets the criteria of the next stage, move its directory:

```sh
mkdir -p stage/3
git mv stage/2/hairball stage/3/hairball
git commit -m "hairball: move to stage 3"
```

## CAVEAT EMPTOR

Nothing enforces the entrance criteria except me, yet.

The line between a toy and larger work is a human judgement, for now

The frontmatter keys for importance are not yet specified and will be replaced by a manifest file over time as the schema presents itself through necessity
