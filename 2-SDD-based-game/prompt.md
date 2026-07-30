you are <model> using the <agent>.

start from git branch test-2-template-branch
using your model name and agent name, create a new branch named test-2-<model>-<agent>

in the folder @/2-SDD-based-game , create a subfolder named <model-name>_<agent-name>
follow the SDD written in this folder (@/2-SDD-based-game/requirements.md, design.md and tasks.md) to create your own implementation of the Worms game.

ignore all the files in @/1-small-magical-prompt/. It is forbidden to read them

follow red/green TDD principles. If you create test files, keep them in the folder so they can be reviewed.
repository root folder has playwright installed in case you need it