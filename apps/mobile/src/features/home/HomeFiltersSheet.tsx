import { useNavigation } from "@react-navigation/native";
import { useRef, useState } from "react";
import { Pressable, ScrollView, type TextInputInstance, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ListSection } from "../../components/ui/ListSection";
import { SearchField } from "../../components/ui/SearchField";
import { SelectionRow } from "../../components/ui/SelectionRow";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { Toolbar } from "../../components/ui/Toolbar";
import { cn } from "../../lib/cn";
import {
  applyHomeListFilterAction,
  buildHomeListFilterSheet,
  filterHomeListProjectEntries,
  homeListProjectSearchEnabled,
  isHomeListFilterCustomized,
  type HomeListFilterMenuEntry,
  type HomeListFilterSheetStatus,
} from "./home-list-filter-menu";
import { TitleRulesSection } from "./TitleRulesSection";
import { useThreadListFilterModel } from "./use-thread-list-filter-model";

function StatusButton(props: {
  readonly status: HomeListFilterSheetStatus;
  readonly onPress: () => void;
}) {
  const { status } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[status.label, status.countSubtitle].filter(Boolean).join(", ")}
      accessibilityState={{ selected: status.selected }}
      onPress={props.onPress}
      className={cn(
        "min-h-12 flex-1 flex-row items-center gap-2 rounded-2xl px-3 py-2 active:opacity-70",
        status.selected ? "bg-primary" : "bg-grouped-card",
      )}
    >
      {/* The checkmark and the fill both mark a selected status, so colour is not the only cue. */}
      <View className="size-4 items-center justify-center">
        {status.selected ? (
          <SymbolView
            name="checkmark"
            size={14}
            tintColorClassName="accent-primary-foreground"
            type="monochrome"
            weight="semibold"
          />
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        className={cn(
          "min-w-0 flex-1 text-base font-t3-medium",
          status.selected ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {status.label}
      </Text>
      {status.count === null ? null : (
        <Text
          className={cn(
            "text-sm",
            status.selected ? "text-primary-foreground" : "text-foreground-muted",
          )}
        >
          {status.count}
        </Text>
      )}
    </Pressable>
  );
}

function EntryList(props: {
  readonly entries: ReadonlyArray<HomeListFilterMenuEntry>;
  readonly role: "radio" | "checkbox";
  readonly onSelect: (id: string) => void;
}) {
  return props.entries.map((entry, index) => (
    <SelectionRow
      key={entry.id}
      title={entry.title}
      role={props.role}
      selected={entry.state === "on"}
      isLast={index === props.entries.length - 1}
      onPress={() => props.onSelect(entry.id)}
    />
  ));
}

function ProjectsSection(props: {
  readonly entries: ReadonlyArray<HomeListFilterMenuEntry>;
  readonly onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<TextInputInstance | null>(null);
  const searchable = homeListProjectSearchEnabled(props.entries);
  const shown = searchable ? filterHomeListProjectEntries(props.entries, query) : props.entries;
  return (
    <View className="gap-2">
      <Text textRole="footnote" className="px-2 font-t3-medium text-foreground-muted">
        Projects
      </Text>
      {searchable ? (
        <SearchField
          inputRef={searchRef}
          autoFocus={false}
          accessibilityLabel="Search projects"
          clearAccessibilityLabel="Clear project search"
          placeholder="Search projects"
          value={query}
          onChangeText={setQuery}
        />
      ) : null}
      <ListSection>
        {shown.length === 0 ? (
          <Text className="px-4 py-3 text-base text-foreground-muted">No matching projects.</Text>
        ) : (
          <EntryList entries={shown} role="checkbox" onSelect={props.onSelect} />
        )}
      </ListSection>
    </View>
  );
}

/**
 * The iOS thread filters, presented from the header's filter button in place of the chip row.
 * Choices apply at once to the list behind the sheet, through the same handlers the menus use.
 */
export function HomeFiltersSheet() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  // The sheet is the focused route, so it reads the thread list whatever Home's visibility says.
  const { filterState, filterControls } = useThreadListFilterModel({ visible: true, menus: true });
  const sheet = buildHomeListFilterSheet(filterState);
  const customized = isHomeListFilterCustomized(filterState);
  const select = (id: string) => applyHomeListFilterAction(id, filterState, filterControls);
  const statusRows = sheet.status === null ? [] : [sheet.status.slice(0, 2), sheet.status.slice(2)];
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader
        presentation="native"
        title="Filters"
        accessibilityLabel="Done"
        onClose={() => navigation.goBack()}
      />
      <Toolbar placement="right">
        <Toolbar.Button
          label="Reset"
          accessibilityLabel="Reset filters"
          disabled={!customized}
          onPress={filterControls.onReset}
        />
      </Toolbar>
      <ScrollView
        alwaysBounceVertical
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        className="flex-1 bg-screen"
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, gap: 14 }}
      >
        {sheet.status === null ? null : (
          <View className="gap-2">
            <Text textRole="footnote" className="px-2 font-t3-medium text-foreground-muted">
              Status
            </Text>
            <View className="gap-2">
              {statusRows.map((row) => (
                <View key={row[0]?.id} className="flex-row gap-2">
                  {row.map((status) => (
                    <StatusButton
                      key={status.id}
                      status={status}
                      onPress={() => select(status.id)}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
        )}
        {sheet.projects === null ? null : (
          <ProjectsSection entries={sheet.projects} onSelect={select} />
        )}
        <ListSection title="Environment">
          <EntryList entries={sheet.environment} role="radio" onSelect={select} />
        </ListSection>
        {sheet.account === null ? null : (
          <ListSection title="Account">
            <EntryList entries={sheet.account} role="radio" onSelect={select} />
          </ListSection>
        )}
        {filterState.enhanced === null ? null : (
          <TitleRulesSection
            rules={filterState.enhanced.rules}
            onChange={filterControls.onTitleRulesChange}
          />
        )}
      </ScrollView>
    </View>
  );
}
