import { createFileRoute } from "@tanstack/react-router";

import { MyTasksPage } from "../components/myTasks/MyTasksPage";

export const Route = createFileRoute("/_chat/my-tasks")({
  component: MyTasksPage,
});
