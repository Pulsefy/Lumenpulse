import { View, Text, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useNotifications } from "@/hooks/useNotifications";

export const HeaderBell = () => {
  const router = useRouter();
  const { data } = useNotifications();

  const unreadCount = data.filter((n) => !n.read).length;

  return (
    <TouchableOpacity onPress={() => router.push("/notifications")}>
      <View>
        <Text>🔔</Text>

        {unreadCount > 0 && (
          <View
            style={{
              position: "absolute",
              top: -5,
              right: -5,
              backgroundColor: "red",
              borderRadius: 10,
              paddingHorizontal: 6,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 10 }}>
              {unreadCount}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};