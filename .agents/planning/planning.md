
# Planning

I'd like to expand the functionality to be more than just Skills. There are a handful of areas in AI where groups are
agreeing on reusable patterns:

* Agents
* Hooks - GitHub
* Hooks - Kiro
* Instructions
* Plugins
* Powers - Ignore this one (still planning)
* Prompts
* Skills - Already implemented

## Marketplace View

I would like each repository to have a node for that area, if a folder with the matching name exists in the repository.

* The repository paths for each of these areas should be stored in `agentOrganizer.skillRepositories`. The `path` property should be updated to a `paths` object and should have a property for each area.
* When loading the marketplace and when refreshing the marketplace, the repository should be searched to see if any new areas have been added.
* Each of these areas will need a unique icon.
  * The icon should be generated in the 4 colors: blue, green, orange, and purple.
  * The icons will be used in the same way as the Skills icons are used to denote uniqueness, duplication and which copy is newest.

### Single File areas

Many of the areas are only individual files:

* Agents - *.agent.md
* Instructions - *.instruction.md
* Prompts - *.prompt.md

* These areas can have a folder structure within the source control repository.
* The tree that displays the files for this area, should also list folders if the repository contains prompt files under folders in that area.

### Multi File areas

Some areas, like Skills, are based around folder structure on disk.

* Hooks - GitHub
  * Definition at: https://code.visualstudio.com/docs/copilot/customization/hooks#_hook-configuration-format
  * Examples at: https://github.com/github/awesome-copilot/tree/main/hooks
  * It's a folder with files underneath
  * The README.md will contain the name and description.
  * There has to be a hooks.json file at the root of the folder, along with the README.md
  * Hooks - GitHub and Hooks - Kiro should use the same icons
* Hooks - Kiro
  * Example: https://github.com/iamaanahmad/everything-kiro-ide/blob/main/hooks/file-watchers.json
  * It's a single file, that can potentially have multiple definitions within it
  * Hooks - GitHub and Hooks - Kiro should use the same icons
* Skills
  * The folder is named after the Skill, and all files under that folder are part of the skill.
  * The definition of the skill comes from the frontmatter of SKILL.md, which must be at the root of the folder.
* Plugins
  * Definition at: https://code.visualstudio.com/docs/copilot/customization/agent-plugins
  * The definition of the Plugin comes from plugin.json, which must be at the root of the folder.
* Powers - Ignore this one (still planning)
  * Definition at: https://kiro.dev/blog/introducing-powers/
  * The folder is named after the Power, and all files under that folder are part of the power.
  * The definition of the Power come from the frontmatter of POWER.md, which must be at the root of the folder.

## New Extension Views for each Area

Currently, Skills has a view.

* I would like to create a view for the other Areas defined above. (Except Powers, that one is still being planned)
* The code behind the Skill view should be refactored to be reused across views when possible.
* The right-click menus should have the same entries across all views, using the Skills view as the example.
  * If an option shouldn't appear, or act differently it will be noted in the sections below

### View Title Bar Commands

* The new views should function the same way as the Skill views, with the same title bar commands.
* Each view specific command should be specific to that area.
* The code behind the Skill commands should be refactored to be reused across views when possible.
  
### View Folder Nodes Commands

* The new view folders should function the same way as the Skill views, with the same folder commands.
* Each view folder specific command should be specific to that area.
* The code behind the Skill folders should be refactored to be reused across views when possible.

### View Item Commands

* The new view items should function the same way as the Skill views, with the same item commands.
* Each view item specific command should be specific to that area.
* The code behind the Skill view items should be refactored to be reused across views when possible.
* The Single File Areas should function slightly differently:
  * Right-click should not contain `Add File` or `Add Folder`
  * Double-clicking should open the file for editing

### Refactor `agentOrganizer.skillRepositories`

* Refactor the setting `agentOrganizer.skillRepositories` to exists in the User Settings as opposed to the User Settings (JSON).
* The display should only one contain properties for `owner`, `repo`, and `branch`.
* If an add button appears in User Settings, then button should take a github url and scan it for the correct values.


## Refactoring Defualt Download Location

* Currently, in Skills, we have an `Install Location` button. We need to make similar buttons for all the Area Views.
  * The names of these should be changed to `Default Download Location`.
* Each Area view should get the list of possible values from a configuration setting.
  * If the configuration setting isn't available, then a default list should be calculated using the description below.
* These are the configuration settings that should hold the collection of possible values (if the configuration setting exists):
  * agents -> `chat.agentFilesLocations`
  * hooks - github -> `chat.hookFilesLocations`
  * hooks - kiro -> no setting, the only location is possible is `.kiro/hooks`
  * instructions -> `chat.instructionsFilesLocations`
  * plugins -> `chat.pluginLocations`
  * prompts -> `chat.promptFilesLocations`
  * skills -> `chat.agentSkillsLocations`
* The Default List should be created from
  * These templated locations:
    * .agents/{area}
    * .claude/{area}
    * .github/{area}
    * .kiro/{area}
    * ~/.agents/{area}
    * ~/.claude/{area}
    * ~/.copilot/{area}
    * ~/.kiro/{area}
  * These `area` values:
    * agents
    * hooks
    * instructions
    * plugins
    * prompts
    * skills
* The setting `agentOrganizer.installLocation` currently only stores the location of the default download location for skills.
  * This setting should be refactored into an array `agentOrganizer.installLocations` which properties for each area.
  * The code should be updated to reflect these changes, including package.json.
  * If `agentOrganizer.installLocations` is not defined in settings, then the setting should be created.
    * When the settings are being created this way, the default value of each setting should be `~/.copilot/{area}`
  * The `Custom Location` option in the QuickPick location menus should take you to the `agentOrganizer.installLocations` setting in User Settings (instead of the User Settings JSON file).

## Adding `Copy To Plugin ...`

* Plugins have a structure where they have some standardized subfolders for
  * /agents
  * /skills
  * /commands - These are prompts
  * /hooks
* Example docs:
  * https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
  * https://code.claude.com/docs/en/plugins
* Can the items in each of the areas above have a right-click menu option for `Copy To Plugin ...`
  * This should appear in the same group as `Copy To ...` and appear below `Copy To ...`
* The copy action should create the area folder in the plugin if it doesn't already exist.
* A right-click option should be added to the Plugins Area:
  * On the Plugin Item, `Get latest copy of AI tools`
  * On the area folders (agents, skills, etc), `Get latest copy of {area}s`
  * On the individual items in an area, `Get latest copy`
    * Individual items should also have a right-click option for `Copy to {area}s`
      * `{area}s` should be `Agents`, `Skills`, `Prompts`, or `Hooks`
* The functionality for getting the latest copy, should get the latest copy of the item for the items original area. The files in the plugin should not be checked to see if they are the latest. This should allow the developer to make changes to the files in the plugin, and then overwrite those files with the files from the original. This allows the developer to make a change, and then "revert it" if they don't like the change.
* The repository, https://github.com/devsforge/marketplace/tree/main/, is doing something unusual.
  * Under their `plugins` folder, they have an `agents` folder.
  * And the `agents` folder is actually filled with plugins.
  * Can this be detected and handled by the Plugins search?
* If a plugin doesn't have a README.md file, can skillDetailPanel say `No README.MD found` instead of `No additional details avaliable.`
* Items in the Agents, Skills, Commands, and Hooks area should have a right-click option `Update Plugins`
  * The option should appear in the same group and below `Copy To Plugins...`
  * The option should search through each plugin and see if that item exists in it's respective folder under a plugin.
    * If it's found, then it should update the plugins copy.

## Adding New Item

* Each Area View's top level folder node should have a right-click option `Add {Area}`
  * This should be the first option in the right-click menu
  * The New option will ask for a `name`
    * The name should be normalized to be
      * lowercase
      * non-alphanumeric characters should be replaced with dashes (-)
      * multiple dashes in a row should be reduced to a single dash
  * This will create a new Area Item under that file location.
  * Here a special instructions for each Area type:
    * Skills
      * Create a folder for the normalized name.
      * The folder should have a SKILL.md
      * SKILL.md should contain frontmatter with properties for `name`, `description`, and `metadata` -> `version`
        * `name` should be the normalized name
        * `metadata` -> `version` should be today's date in "yyyy.MM.dd" format
    * Agents
      * Create a single file, named `{normalized-name}.agents.md`
      * The file should contain frontmatter with properties for `name`, `description`
        * `name` should be the normalized name
    * Hooks - GitHub
      * Create a folder for the normalized name.
      * Create a file named `README.md`
        * Should contain frontmatter with properties for `name`, `description`, `tags` and `metadata` -> `version`
          * `name` should be the normalized name
          * `tags` should be an empty array
          * `metadata` -> `version` should be today's date in "yyyy.MM.dd" format
      * Create a file named `{normalized-name}.hooks.json`
        * The file contents should default to:
          {
            "version": 1,
            "hooks": {
            }
          }
    * Hooks - Kiro
      * Do the same thing as `Hooks - GitHub`
    * Instructions
      * Create a single file, named `{normalized-name}.instruction.md`
        * The file should contain frontmatter with properties for `name`, `description`
          * `name` should be the normalized name
    * Plugins
      * Create a folder for the normalized name.
      * The folder should have a README.md
      * README.md should contain frontmatter with properties for `name`, `description`, and `metadata` -> `version`
        * `name` should be the normalized name
      * The folder should have a plugin.json
        * Example format:
          {
            "name": "my-dev-tools",
            "description": "React development utilities",
            "version": "1.2.0",
            "author": {
              "name": "Jane Doe",
              "email": "jane@example.com"
            },
            "license": "MIT",
            "keywords": ["react", "frontend"],
            "agents": "agents/",
            "skills": ["skills/", "extra-skills/"],
            "hooks": "hooks.json",
            "mcpServers": ".mcp.json"
          }
        * Example format from: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating
          * Which is superset of: https://code.claude.com/docs/en/plugins
      * The folder should contain an `.mcp.json`
        * The `.mcp.json` contents should default to:
          {
            "mcpServers": {
            }
          }
      * The folder should contain a folder `.claude-plugin`. The folder should contains
        * A symlink for `plugin.json` which points to the root level `plugin.json`
    * Prompts
      * Create a single file, named `{normalized-name}.prompt.md`
        * The file should contain frontmatter with properties for `name`, `description`
          * `name` should be the normalized name
* The Title Bar Commands on each Area View should have a `Add {Area}` button added. The `Add {Area}` button:
  * Shold be between the `Default Download Location` and `Expand All` buttons
  * Should do the same things as the `New` right-click option, except ...
  * It should a quick pick menu to ask where the file should be created
  * The quick pick menu should
    * List locations from the associated configuration setting (see `Refactoring Defualt Download Location` above)
    * Include a `Custom...` option. if `Custom...` is used:
      * Only allow relative paths or paths that start with `~` (user folder)
      * Don't allow `..`'s in paths
      * Implement other defensive measures so that paths can't be used for malicious intent
      * If the path ends in `.md`, assume the last segment is the name of the item they want to create.
  * If the location doesn't exist, create it.

## Adding `Copy Name` and `Rename`

* All Area Items should have a right-click option for `Rename`
  * This options should be in the same group and above `Move To...`
  * When an Area Item is selected, can F2 initiate rename?
* All Area Items should have a right-click option for `Copy Name`, that will copy the name to the clipboard
  * This option should be in the same group and below `Rename`
